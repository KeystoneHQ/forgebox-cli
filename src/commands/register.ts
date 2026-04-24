import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { createHash, createPublicKey } from 'crypto';
import chalk from 'chalk';
import ora from 'ora';
import { UsbManager } from '../lib/usb-manager';
import { CryptoManager } from '../lib/crypto';

function shouldUseLegacyRegistration(firmwareVersion: unknown): boolean {
  return String(firmwareVersion || '').trim() === '1.0.0';
}

export function registerRegisterCommand(program: Command) {
  program
    .command('register [directory]')
    .description('Register a public key to the hardware device')
    .option('-p, --pubkey <file>', 'Path to public key file (PEM format)')
    .option('-k, --key <file>', 'Path to private key file (for proof of possession)')
    .addHelpText('after', `
17→
18→Examples:
19→  $ forgebox register --pubkey ./my-keys/pubkey.pem --key ./my-keys/private.pem
20→  $ forgebox register ./my-keys
21→`)
    .action(async (directory, options) => {
      let pubKeyPath: string;
      let privKeyPath: string;

      if (directory) {
        // Mode 1: Directory provided
        const dirPath = path.resolve(process.cwd(), directory);
        if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
             console.error(chalk.red(`Error: Directory not found: ${dirPath}`));
             process.exit(1);
        }
        pubKeyPath = path.join(dirPath, 'pubkey.pem');
        privKeyPath = path.join(dirPath, 'private.pem');
        console.log(chalk.gray(`Loading keys from directory: ${dirPath}`));
      } else {
        // Mode 2: Explicit options
        if (!options.pubkey || !options.key) {
             console.error(chalk.red('Error: You must provide either a directory OR both --pubkey and --key options.'));
             process.exit(1);
        }
        pubKeyPath = path.resolve(process.cwd(), options.pubkey);
        privKeyPath = path.resolve(process.cwd(), options.key);
      }
      
      // 1. Read files
      if (!fs.existsSync(pubKeyPath)) {
        console.error(chalk.red(`Error: Public key file not found at ${pubKeyPath}`));
        process.exit(1);
      }
      if (!fs.existsSync(privKeyPath)) {
        console.error(chalk.red(`Error: Private key file not found at ${privKeyPath}`));
        process.exit(1);
      }

      const pubKeyContent = fs.readFileSync(pubKeyPath, 'utf-8');
      const privKeyContent = fs.readFileSync(privKeyPath, 'utf-8');
      
      // Simple validation for PEM format
      if (!pubKeyContent.includes('BEGIN PUBLIC KEY')) {
        console.error(chalk.red('Error: Invalid PEM format. File must contain "BEGIN PUBLIC KEY" header.'));
        process.exit(1);
      }

      // 2. Generate Proof of Possession
      const prepSpinner = ora('Generating Proof of Possession signature...').start();
      let signature: Buffer;
      let nonce: Buffer | null = null;
      let rawPubKey: Buffer;
      try {
        // Convert PEM to Raw Public Key (Uncompressed 65 bytes)
        const keyObj = createPublicKey(pubKeyContent);
        const der = keyObj.export({ format: 'der', type: 'spki' });
        
        // Extract uncompressed key: 0x04 + X (32) + Y (32)
        rawPubKey = der.subarray(der.length - 65);

        console.log(chalk.gray(`\nPreparing to send public key with signature...`));
        console.log(chalk.gray(`  Public key: ${rawPubKey.toString('hex')}`));

        prepSpinner.succeed(`Public key prepared (Uncompressed Key: ${rawPubKey.length} bytes).`);
      } catch (error: any) {
        prepSpinner.fail(chalk.red('Failed to generate signature. Please verify your private key and public key are valid and correspond to the same key pair.'));
        console.error(error.message);
        process.exit(1);
      }

      const spinner = ora('Searching for ForgeBox device...').start();

      try {
        // 2. Connect to device
        const device = await UsbManager.findDevice();
        // device is already connected
        
        const info = device.getInfo();
        const status = await device.getStatus();
        const firmwareVersion = String(status?.firmwareVersion || '').trim();
        const useLegacyRegistration = shouldUseLegacyRegistration(firmwareVersion);
        // console.log(device,'devicedevice');
        spinner.succeed(chalk.green(`Connected to ${info.product} (${info.manufacturer})`));
        console.log(chalk.gray(`  Serial: ${info.serialNumber}`));
        console.log('');

        spinner.start('Preparing registration...');
        try {
          if (useLegacyRegistration) {
            signature = CryptoManager.sign(privKeyContent, rawPubKey);
          } else {
            nonce = await device.getNonce();
            const signPayload = Buffer.concat([rawPubKey, nonce]);
            signature = CryptoManager.sign(privKeyContent, signPayload);
          }
        } catch {
          throw new Error('Failed to prepare registration request.');
        }

        // Calculate fingerprint for verification
        const fingerprint = createHash('sha256').update(rawPubKey).digest('hex');

        // 5. Prepare to write
        spinner.start('Waiting for user confirmation on device...');
        
        console.log('');
        console.log(chalk.cyan('  Public Key Fingerprint (SHA256):'));
        console.log(chalk.white(`  ${fingerprint}`));
        console.log('');
        console.log(chalk.yellow('  👉 Please COMPARE the fingerprint above with the one shown on the device.'));
        console.log(chalk.yellow('  👉 If they match, SWIPE on the device to confirm registration.\n'));

        // 6. Send command and wait
        const success = useLegacyRegistration
          ? await device.registerPublicKeyLegacy(rawPubKey, signature)
          : await device.registerPublicKey(rawPubKey, nonce!, signature);

        if (!success) {
             // throw new Error('Device returned failure status. Please check the device screen and try again.');
            await device.disconnect(); 
            process.exit(1);
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
        process.exit(0);
      } catch (error: any) {
        console.log(chalk.red('Operation failed:'), error);
        process.exit(1); // REMOVED
      } finally {
        // Disconnect
        // if (device) await device.disconnect(); 
        // Scope issue with device, actual code should define let device outside try block
      }
    });
}
