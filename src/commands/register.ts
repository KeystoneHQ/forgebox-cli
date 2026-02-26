import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { createHash, createPublicKey } from 'crypto';
import chalk from 'chalk';
import ora from 'ora';
import { UsbManager } from '../lib/usb-manager';
import { CryptoManager } from '../lib/crypto';

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
      
      // 1. 读取文件
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
      
      // 简单验证一下是否是 PEM 格式
      if (!pubKeyContent.includes('BEGIN PUBLIC KEY')) {
        console.error(chalk.red('Error: Invalid PEM format. File must contain "BEGIN PUBLIC KEY" header.'));
        process.exit(1);
      }

      // 2. 生成持有权证明 (Proof of Possession)
      const prepSpinner = ora('Generating Proof of Possession signature...').start();
      let signature: Buffer;
      let rawPubKey: Buffer;
      try {
        // Convert PEM to Raw Public Key (Uncompressed 65 bytes)
        const keyObj = createPublicKey(pubKeyContent);
        const der = keyObj.export({ format: 'der', type: 'spki' });
        
        // Extract uncompressed key: 0x04 + X (32) + Y (32)
        rawPubKey = der.subarray(der.length - 65);

        console.log(chalk.gray(`\nPreparing to send public key with signature...`));
        console.log(chalk.gray(`  Public key: ${rawPubKey.toString('hex')}`));

        // Sign the UNCOMPRESSED public key bytes
        signature = CryptoManager.sign(privKeyContent, rawPubKey);
        console.log(chalk.gray(`  Signature: ${signature.toString('hex')}`));
        
        prepSpinner.succeed(`Proof of Possession signature generated (Uncompressed Key: ${rawPubKey.length} bytes).`);
      } catch (error: any) {
        prepSpinner.fail(chalk.red('Failed to generate signature. Check your private key.'));
        console.error(error.message);
        process.exit(1);
      }

      const spinner = ora('Searching for ForgeBox device...').start();

      try {
        // 2. 连接设备
        const device = await UsbManager.findDevice();
        // device is already connected
        
        const info = device.getInfo();
        // console.log(device,'devicedevice');
        spinner.succeed(chalk.green(`Connected to ${info.product} (${info.manufacturer})`));
        console.log(chalk.gray(`  Serial: ${info.serialNumber}`));
        console.log('');

        // Calculate fingerprint for verification
        const fingerprint = createHash('sha256').update(rawPubKey).digest('hex');

        // 3. 准备写入
        spinner.start('Waiting for user confirmation on device...');
        
        console.log('');
        console.log(chalk.cyan('  Public Key Fingerprint (SHA256):'));
        console.log(chalk.white(`  ${fingerprint}`));
        console.log('');
        console.log(chalk.yellow('  👉 Please COMPARE the fingerprint above with the one shown on the device.'));
        console.log(chalk.yellow('  👉 If they match, SWIPE on the device to confirm registration.\n'));

        // 4. 发送指令并等待 (Send RAW key + Signature)
        await device.registerPublicKey(rawPubKey, signature);
        
        spinner.succeed(chalk.green('Public key registered successfully!'));

        // 5. 成功后的引导
        console.log('');
        console.log(chalk.cyan('  Success:'));
        console.log(chalk.white('  The public key has been securely stored on the ForgeBox device.'));
        console.log(chalk.white('  You can now sign your custom firmware using the CLI.'));
        console.log('');
        console.log(chalk.cyan('  Next Step:'));
        console.log(chalk.white('  $ ') + chalk.yellow(`forgebox sign --file <firmware.bin> --key <private.pem>`));

      } catch (error: any) {
        const msg = error.message || '';
        
        if (msg.toLowerCase().includes('cancel')) {
            // Case: 用户取消
            spinner.warn(chalk.yellow('Operation cancelled by user.'));
            console.log(chalk.gray('  Please run the command again, and follow the prompt on the device screen to "Swipe to register".'));
        } else if (msg.toLowerCase().includes('disconnected') || msg.toLowerCase().includes('not found')) {
            // Case: USB 意外断联
            spinner.fail(chalk.red('Connection lost or device not found.'));
            console.log(chalk.gray('  Please check your USB cable connection and try again.'));
        } else if (msg.toLowerCase().includes('full') || msg.toLowerCase().includes('write failed')) {
            // Case: 硬件故障 (如 16 个 slot 满或写入失败)
            spinner.fail(chalk.red('Hardware storage error.'));
            console.log(chalk.gray('  Failed to write public key. Please refer to the README for troubleshooting or contact support.'));
        } else {
            // Case: 签名验证失败/文件损坏/其他
            spinner.fail(chalk.red(`Operation failed: ${msg}`));
            // console.log(chalk.gray('  Please check if the public key file is valid or regenerate the key pair.'));
            console.log(chalk.gray('  Please check if the device is connected and try again.'));
        }
      } finally {
        // 断开连接
        // if (device) await device.disconnect(); 
        // 这里的 device 作用域问题，实际代码应该在 try 外部定义 let device
      }
    });
}
