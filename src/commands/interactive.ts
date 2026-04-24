import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { createHash, createPublicKey } from 'crypto';
import { UsbManager } from '../lib/usb-manager';
import { CryptoManager } from '../lib/crypto';

const DEFAULT_KEY_DIR = path.join(os.homedir(), '.forgebox', 'keys');

function shouldUseLegacyRegistration(firmwareVersion: unknown): boolean {
  return String(firmwareVersion || '').trim() === '1.0.0';
}

function isInsideGitRepo(dir: string): boolean {
  let cur = path.resolve(dir);
  while (cur !== path.dirname(cur)) {
    if (fs.existsSync(path.join(cur, '.git'))) return true;
    cur = path.dirname(cur);
  }
  return false;
}

export function registerInteractiveCommand(program: Command) {
  program
    .command('interactive')
    .alias('i')
    .description('Start interactive mode')
    .action(async () => {
      console.log(chalk.cyan('\nWelcome to ForgeBox Interactive Mode\n'));
      await showMainMenu();
    });
}

async function showMainMenu() {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        'List Devices',
        'Get Device Status',
        'Generate Key Pair',
        'Register Public Key',
        'Exit'
      ]
    }
  ]);

  switch (action) {
    case 'List Devices':
      await handleListDevices();
      break;
    case 'Get Device Status':
      await handleGetStatus();
      break;
    case 'Generate Key Pair':
      await handleGenerateKeyPair();
      break;
    case 'Register Public Key':
      await handleRegisterPublicKey();
      break;
    case 'Exit':
      console.log('Bye!');
      process.exit(0);
  }

  // Loop back to main menu
  console.log('');
  await showMainMenu();
}

async function handleGenerateKeyPair() {
  const { outputDir } = await inquirer.prompt([
    {
      type: 'input',
      name: 'outputDir',
      message: 'Enter output directory:',
      default: DEFAULT_KEY_DIR
    }
  ]);

  const resolvedPath = path.resolve(process.cwd(), outputDir);

  if (isInsideGitRepo(resolvedPath)) {
    const { proceed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceed',
        message: chalk.red(
          `Path is inside a git working tree:\n  ${resolvedPath}\n` +
          `A committed private key is equivalent to publishing it. Continue anyway?`
        ),
        default: false,
      },
    ]);
    if (!proceed) {
      console.log(chalk.yellow('Aborted. Re-run and pick a directory outside any repo.'));
      process.exit(1);
    }
  }

  const spinner = ora(`Generating key pair in ${resolvedPath}...`).start();

  try {
    const keyPair = CryptoManager.generateKeyPair();
    const paths = CryptoManager.saveKeys(keyPair, resolvedPath);

    spinner.succeed(chalk.green('Key pair generated.'));
    console.log('');
    console.log(`  ${chalk.cyan('Private Key:')} ${paths.privPath} ${chalk.gray('(0600)')}`);
    console.log(`  ${chalk.cyan('Public Key: ')} ${paths.pubPath}`);
    console.log('');
    console.log(chalk.yellow('  ⚠  This private key is the ONLY thing that can sign firmware'));
    console.log(chalk.yellow('     for your device after registration. The device accepts'));
    console.log(chalk.yellow('     ONE public-key registration per lifetime.'));
    console.log(chalk.yellow('  ⚠  Back up both files offline BEFORE running `forgebox register`.'));

    process.exit(0); // REMOVED: Return to menu
  } catch (error: any) {
    spinner.fail(chalk.red('Failed to generate key pair'));
    console.error(error.message);
    process.exit(1); // REMOVED
  }
}

async function handleRegisterPublicKey() {
  const { inputType } = await inquirer.prompt([
    {
      type: 'list',
      name: 'inputType',
      message: 'How would you like to provide the keys?',
      choices: [
        'Load from Local File (PEM)',
        new inquirer.Separator(),
        '< Back'
      ]
    }
  ]);

  if (inputType === '< Back') {
    return;
  }

  let rawPubKey: Buffer;
  let rawPrivKey: string;

  // Load from File
  const { keyDir } = await inquirer.prompt([
    {
      type: 'input',
      name: 'keyDir',
      message: 'Enter directory path containing keys:',
      default: DEFAULT_KEY_DIR
    }
  ]);

    const dirPath = path.resolve(process.cwd(), keyDir);
    const pubPath = path.join(dirPath, 'pubkey.pem');
    const privPath = path.join(dirPath, 'private.pem');

    if (!fs.existsSync(pubPath) || !fs.existsSync(privPath)) {
      console.error(chalk.red(`\nError: Keys not found in ${dirPath}`));
      console.error(`Expected files: pubkey.pem, private.pem`);
      return;
    }

    try {
      const pubKeyContent = fs.readFileSync(pubPath, 'utf-8');
      const privKeyContent = fs.readFileSync(privPath, 'utf-8');

      // Parse Public Key PEM to Raw
      const keyObj = createPublicKey(pubKeyContent);
      const der = keyObj.export({ format: 'der', type: 'spki' });
      // Extract uncompressed key: last 65 bytes
      rawPubKey = der.subarray(der.length - 65);
      
      // Use PEM content for signing
    rawPrivKey = privKeyContent;
    
    console.log(chalk.gray(`\nLoaded keys from ${dirPath}`));
    console.log(chalk.gray(`Public Key: ${rawPubKey.toString('hex')}`));
  } catch (e: any) {
    console.log(chalk.red('Failed to generate signature. Please verify your private key and public key are valid and correspond to the same key pair.'));
    console.log(e.message);
    process.exit(1); // REMOVED
  }
  let signature: Buffer;
  let nonce: Buffer | null = null;

  const spinner = ora('Connecting to device...').start();
  try {
    const device = await UsbManager.findDevice();
    // device is already connected
    
    const info = device.getInfo();
    const status = await device.getStatus();
    const firmwareVersion = String(status?.firmwareVersion || '').trim();
    const useLegacyRegistration = shouldUseLegacyRegistration(firmwareVersion);
    spinner.succeed(chalk.green(`Connected to ${info.product} (${info.manufacturer})`));
    console.log(chalk.gray(`  Serial: ${info.serialNumber}`));
    console.log('');

    spinner.start('Preparing registration...');
    try {
      if (useLegacyRegistration) {
        signature = CryptoManager.sign(rawPrivKey, rawPubKey);
      } else {
        nonce = await device.getNonce();
        const signPayload = Buffer.concat([rawPubKey, nonce]);
        signature = CryptoManager.sign(rawPrivKey, signPayload);
      }
    } catch {
      throw new Error('Failed to prepare registration request.');
    }

    // Calculate fingerprint for verification
    const fingerprint = createHash('sha256').update(rawPubKey).digest('hex');

    spinner.start('Waiting for user confirmation on device...');
    
    console.log('');
    console.log(chalk.cyan('  Public Key Fingerprint (SHA256):'));
    console.log(chalk.white(`  ${fingerprint}`));
    console.log('');
    console.log(chalk.yellow('  👉 Please COMPARE the fingerprint above with the one shown on the device.'));
    console.log(chalk.yellow('  👉 If they match, SWIPE on the device to confirm registration.\n'));

    const success = useLegacyRegistration
      ? await device.registerPublicKeyLegacy(rawPubKey, signature)
      : await device.registerPublicKey(rawPubKey, nonce!, signature);
    
    if (!success) {
      // throw new Error('Device returned failure status. Please check the device screen and try again.');
      await device.disconnect();
      process.exit(0); // REMOVED
    }

    spinner.succeed(chalk.green('Public key registered successfully!'));

    // 5. Post-success guidance
    console.log('');
    console.log(chalk.cyan('  Success:'));
    console.log(chalk.white('  The public key has been securely stored on the ForgeBox device.'));
    console.log(chalk.white('  You can now sign your custom firmware using the CLI.'));
    console.log('');
    console.log(chalk.cyan('  Next Step:'));
    console.log(chalk.white('  $ ') + chalk.yellow(`forgebox sign --file <firmware.bin> --key <private.pem>`));

    await device.disconnect();
    process.exit(0); // REMOVED
  } catch (error: any) {
    console.log(chalk.red('Operation failed:'), error);
    process.exit(1); // REMOVED
  }
}

async function handleGetStatus() {
  const spinner = ora('Getting status...').start();
  try {
    const device = await UsbManager.findDevice();
    // device is already connected by UsbManager.findDevice()
    
    const status = await device.getStatus();
    
    spinner.succeed('Status retrieved');
    console.log(chalk.green('\n✓ Device Information:'));
    
    if (status) {
       console.log(chalk.gray(`  Model: ${chalk.white(status.model || 'Unknown')}`));
       console.log(chalk.gray(`  Firmware: ${chalk.white(status.firmwareVersion || 'Unknown')}`));
       console.log(chalk.gray(`  Serial: ${chalk.white(status.serialNumber || 'Unknown')}`));
       console.log(chalk.gray(`  Hardware: ${chalk.white(status.hardwareVersion || 'Unknown')}`));
    } else {
       console.log(chalk.yellow('  No device information available'));
    }
    
    await device.disconnect();
    process.exit(0); // REMOVED
  } catch (error: any) {
    spinner.fail('Failed to get status');
    console.error(error instanceof Error ? error.message : JSON.stringify(error));
    if (process.env.DEBUG) console.error(error);
    process.exit(1); // REMOVED
  }
}

async function handleListDevices() {
  try {
    const devices = await UsbManager.listDevices();
    console.log(chalk.blue('Scanning for USB devices...'));
    if (devices.length === 0) {
      console.log(chalk.yellow('No devices found.'));
    } else {
      console.log(chalk.green(`\nFound ${devices.length} device(s):\n`));
        
      // Table output
      console.log(
        chalk.gray('Product'.padEnd(30)) + 
        chalk.gray('Manufacturer'.padEnd(20)) +
        chalk.gray('Serial'.padEnd(20)) +
        chalk.gray('VID'.padEnd(8)) + 
        chalk.gray('PID'.padEnd(8))
      );
      console.log(chalk.gray('-'.repeat(86)));

      devices.forEach(d => {
        const vid = '0x' + d.vendorId.toString(16).padStart(4, '0');
        const pid = '0x' + d.productId.toString(16).padStart(4, '0');
        
        console.log(
          (d.product || 'Unknown').substring(0, 28).padEnd(30) + 
          (d.manufacturer || 'Unknown').substring(0, 18).padEnd(20) +
          (d.serialNumber || '').substring(0, 18).padEnd(20) +
          vid.padEnd(8) + 
          pid.padEnd(8)
        );
      });
      console.log('');
    }
    process.exit(0); // REMOVED
  } catch (e: any) {
    console.error('Error:', e.message);
    process.exit(1); // REMOVED
  }
}
