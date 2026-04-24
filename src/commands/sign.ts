import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { createPrivateKey } from 'crypto';
import chalk from 'chalk';
import ora from 'ora';
import { processOta } from '../lib/sign_verify';

export function registerSignCommand(program: Command) {
  program
    .command('sign')
    .description('Sign firmware into OTA package')
    .requiredOption('-s, --s <path>', 'Source firmware file path')
    .requiredOption('-d, --d <path>', 'Destination signed file path')
    .requiredOption('-k, --key <path>', 'Private key PEM file path')
    .addHelpText('after', `

Examples:
  $ forgebox sign --s firmware.bin --d update.bin --key ./my-keys/private.pem
`)
    .action(async (options) => {
      const sourcePath = path.resolve(process.cwd(), options.s);
      const destPath = path.resolve(process.cwd(), options.d);
      const keyInput = String(options.key || '').trim();
      const keyPath = path.resolve(process.cwd(), keyInput);
      if (!fs.existsSync(sourcePath)) {
        console.error(chalk.red(`Error: File not found: ${sourcePath}`));
        process.exit(1);
      }

      let privateKeyHex = '';

      if (!fs.existsSync(keyPath)) {
        console.error(chalk.red(`Error: Private key file not found: ${keyPath}`));
        process.exit(1);
      }

      const keyContent = fs.readFileSync(keyPath, 'utf-8').trim();
      if (!keyContent.includes('BEGIN')) {
        console.error(chalk.red('Error: Invalid private key file. Only PEM format is supported (BEGIN EC PRIVATE KEY / BEGIN PRIVATE KEY).'));
        process.exit(1);
      }

      try {
        const keyObj = createPrivateKey(keyContent);
        const jwk = keyObj.export({ format: 'jwk' }) as { d?: string };
        if (!jwk.d) {
          console.error(chalk.red('Error: Invalid private key (missing JWK d).'));
          process.exit(1);
        }
        privateKeyHex = Buffer.from(jwk.d, 'base64url').toString('hex');
      } catch {
        console.error(chalk.red('Error: Failed to parse private key. Please use an unencrypted secp256k1 private key in PEM format (BEGIN EC PRIVATE KEY / BEGIN PRIVATE KEY).'));
        process.exit(1);
      }

      if (!/^[0-9a-fA-F]{64}$/.test(privateKeyHex)) {
        console.error(chalk.red('Error: Invalid private key PEM content. Expected a secp256k1 private key.'));
        process.exit(1);
      }

      const spinner = ora('Signing firmware...').start();

      try {
        processOta(sourcePath, destPath, privateKeyHex);
        spinner.succeed(chalk.green('Signed firmware generated successfully!'));
        console.log(chalk.gray(`  Output: ${destPath}`));
        console.log('');
      } catch (error: any) {
        spinner.fail(chalk.red(`Operation failed: ${error.message}`));
      }
    });
}
