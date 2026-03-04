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
    .requiredOption('-k, --key <value>', 'Private key path or hex string')
    .addHelpText('after', `

Examples:
  $ forgebox sign --s firmware.bin --d update.bin --key ./my-keys/private.pem
  $ forgebox sign -s firmware.bin -d update.bin --key 1ac4593491b2f705e94ffb0249a7def9ddf0cf5c0ba5647469bfd7f531299a62
`)
    .action(async (options) => {
      const sourcePath = path.resolve(process.cwd(), options.s);
      const destPath = path.resolve(process.cwd(), options.d);
      const keyInput = String(options.key || '').trim();
      if (!fs.existsSync(sourcePath)) {
        console.error(chalk.red(`Error: File not found: ${sourcePath}`));
        process.exit(1);
      }

      let privateKeyHex = '';

      if (fs.existsSync(path.resolve(process.cwd(), keyInput))) {
        const keyPath = path.resolve(process.cwd(), keyInput);
        const keyContent = fs.readFileSync(keyPath, 'utf-8').trim();
        if (keyContent.includes('BEGIN')) {
          try {
            const keyObj = createPrivateKey(keyContent);
            const jwk = keyObj.export({ format: 'jwk' }) as { d?: string };
            if (!jwk.d) {
              console.error(chalk.red('Error: Invalid private key (missing JWK d).'));
              process.exit(1);
            }
            privateKeyHex = Buffer.from(jwk.d, 'base64url').toString('hex');
          } catch {
            console.error(chalk.red('Error: '), "Failed to parse private key. Please use an unencrypted secp256k1 private key in PEM format (BEGIN EC PRIVATE KEY / BEGIN PRIVATE KEY), or provide a 64-character hex private key.");
            process.exit(1);
          }
        } else {
          privateKeyHex = keyContent;
        }
      } else {
        privateKeyHex = keyInput;
      }

      if (!/^[0-9a-fA-F]{64}$/.test(privateKeyHex)) {
        console.error(chalk.red('Error: Invalid private key hex. Expected 64 hex characters.'));
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
