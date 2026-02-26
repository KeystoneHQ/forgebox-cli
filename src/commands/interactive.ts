import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import * as fs from 'fs';
import { createHash, createPublicKey } from 'crypto';
import { UsbManager } from '../lib/usb-manager';
import { CryptoManager } from '../lib/crypto';

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
        'Send K1 Public Key',
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
    case 'Send K1 Public Key':
      await handleSendK1PublicKey();
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
      default: './my-keys'
    }
  ]);

  const resolvedPath = path.resolve(process.cwd(), outputDir);
  const spinner = ora(`Generating key pair in ${outputDir}...`).start();

  try {
    const keyPair = CryptoManager.generateKeyPair();
    const paths = CryptoManager.saveKeys(keyPair, resolvedPath);
    
    spinner.succeed(chalk.green('Key pair generated successfully!'));
    console.log(chalk.gray(`\n  Public Key:  ${paths.pubPath}`));
    console.log(chalk.gray(`  Private Key: ${paths.privPath}\n`));
    
    process.exit(0); // Exit after success
  } catch (error: any) {
    spinner.fail(chalk.red('Failed to generate key pair'));
    console.error(error.message);
    process.exit(1);
  }
}

async function handleSendK1PublicKey() {
  const { inputType } = await inquirer.prompt([
    {
      type: 'list',
      name: 'inputType',
      message: 'How would you like to provide the keys?',
      choices: [
        'Enter Hex Keys Manually',
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
  let rawPrivKey: Buffer | string; // Hex buffer or PEM string

  if (inputType === 'Enter Hex Keys Manually') {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'pubkey',
        message: 'Enter Public Key (Hex):',
        validate: (input) => {
          if (!/^[0-9a-fA-F]+$/.test(input)) return 'Must be valid Hex string';
          if (input.length !== 130) return 'Public Key must be 65 bytes (130 hex chars)';
          if (!input.startsWith('04')) return 'Public Key must start with 04 (Uncompressed)';
          return true;
        }
      },
      {
        type: 'input',
        name: 'privkey',
        message: 'Enter Private Key (Hex):',
        validate: (input) => {
          if (!/^[0-9a-fA-F]+$/.test(input)) return 'Must be valid Hex string';
          if (input.length !== 64) return 'Private Key must be 32 bytes (64 hex chars)';
          return true;
        }
      }
    ]);
    rawPubKey = Buffer.from(answers.pubkey, 'hex');
    rawPrivKey = Buffer.from(answers.privkey, 'hex');
  } else {
    // Load from File
    const { keyDir } = await inquirer.prompt([
      {
        type: 'input',
        name: 'keyDir',
        message: 'Enter directory path containing keys:',
        default: './my-keys'
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
      console.error(chalk.red('Failed to parse keys:'), e.message);
      return;
    }
  }

  console.log(chalk.gray(`\nGenerating signature...`));
  
  let signature: Buffer;
  try {
    if (Buffer.isBuffer(rawPrivKey)) {
      // Hex Key
      signature = CryptoManager.signBuffer(rawPrivKey, rawPubKey);
    } else {
      // PEM String
      signature = CryptoManager.sign(rawPrivKey, rawPubKey);
    }
    console.log(chalk.gray(`Signature: ${signature.toString('hex')}`));
  } catch (e: any) {
    console.error(chalk.red('Failed to generate signature:'), e.message);
    return;
  }

  const spinner = ora('Connecting to device...').start();
  try {
    const device = await UsbManager.findDevice();
    await device.connect();
    
    // Fingerprint check
    const fingerprint = createHash('sha256').update(rawPubKey).digest('hex');
    spinner.stop();
    
    console.log(chalk.cyan('\n  Public Key Fingerprint (SHA256):'));
    console.log(chalk.white(`  ${fingerprint}\n`));
    console.log(chalk.yellow('  👉 Please COMPARE with device screen and SWIPE to confirm.'));

    spinner.start('Waiting for confirmation...');
    await device.registerPublicKey(rawPubKey, signature);
    spinner.succeed(chalk.green('Public key registered successfully!'));
    
    process.exit(0); // Exit after success
  } catch (error: any) {
    spinner.fail(chalk.red('Registration failed'));
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  }
}

async function handleGetStatus() {
  const spinner = ora('Getting status...').start();
  try {
    const device = await UsbManager.findDevice();
    await device.connect();
    const status = await device.getStatus();
    
    spinner.succeed('Status retrieved');
    console.log(chalk.green('\n✓ Device Information:'));
    
    if (status.tlvArray) {
       // Manual render logic similar to status command
       const findValue = (type: number) => {
         const item = status.tlvArray.find((t: any) => t.type === type);
         return item ? item.value.toString('utf-8').replace(/\0/g, '') : '';
       };
       
       console.log(chalk.gray(`  Model: ${chalk.white(findValue(1) || 'Unknown')}`));
       console.log(chalk.gray(`  Firmware: ${chalk.white(findValue(4) || 'Unknown')}`));
       console.log(chalk.gray(`  Serial: ${chalk.white(findValue(2) || 'Unknown')}`));
       console.log(chalk.gray(`  Hardware: ${chalk.white(findValue(3) || 'Unknown')}`));
    }
    
    await device.disconnect();
    process.exit(0); // Exit after success
  } catch (error: any) {
    spinner.fail('Failed to get status');
    // console.error(error instanceof Error ? error.message : JSON.stringify(error));
    console.log(error);
    process.exit(1);
  }
}

async function handleListDevices() {
  try {
    const devices = await UsbManager.listDevices();
    if (devices.length === 0) {
      console.log(chalk.yellow('No devices found.'));
    } else {
      console.log(chalk.green(`\nFound ${devices.length} device(s):\n`));
        
      // 表格输出
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
    process.exit(0); // Exit after success
  } catch (e: any) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}