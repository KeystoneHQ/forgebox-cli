import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { createPublicKey } from 'crypto';
import chalk from 'chalk';
import ora from 'ora';
import { verifyOta } from '../lib/sign_verify';

function normalizePublicKeyHex(hex: string): string {
  const cleaned = hex.trim().replace(/^0x/i, '');
  if (/^[0-9a-fA-F]{130}$/.test(cleaned)) {
    if (!cleaned.startsWith('04')) {
      throw new Error('Public key must start with 04 for uncompressed format.');
    }
    return cleaned.toLowerCase();
  }
  if (/^[0-9a-fA-F]{128}$/.test(cleaned)) {
    return `04${cleaned}`.toLowerCase();
  }
  throw new Error('Invalid public key hex. Expected 128 or 130 hex characters.');
}

function resolvePublicKeyHex(input: string): string {
  const possiblePath = path.resolve(process.cwd(), input);
  if (fs.existsSync(possiblePath)) {
    const keyContent = fs.readFileSync(possiblePath, 'utf-8').trim();
    if (keyContent.includes('BEGIN PUBLIC KEY')) {
      const keyObj = createPublicKey(keyContent);
      const der = keyObj.export({ format: 'der', type: 'spki' });
      const rawPubKey = der.subarray(der.length - 65);
      return rawPubKey.toString('hex');
    }
    return normalizePublicKeyHex(keyContent);
  }
  return normalizePublicKeyHex(input);
}

export function registerVerifyCommand(program: Command) {
  program
    .command('verify')
    .description('Verify OTA signed firmware')
    .requiredOption('-s, --s <path>', 'Signed OTA file path')
    .option('-o, --o <path>', 'Original firmware file path (optional)')
    .requiredOption('-p, --pubkey <value>', 'Public key path or hex string')
    .addHelpText('after', `

Examples:
  $ forgebox verify --s update.bin --pubkey ./my-keys/pubkey.pem
  $ forgebox verify -s update.bin -o firmware.bin --pubkey 044c...ed800
`)
    .action(async (options) => {
      const signedPath = path.resolve(process.cwd(), options.s);
      const originalPath = options.o ? path.resolve(process.cwd(), options.o) : null;

      if (!fs.existsSync(signedPath)) {
        console.error(chalk.red(`Error: File not found: ${signedPath}`));
        process.exit(1);
      }
      if (originalPath && !fs.existsSync(originalPath)) {
        console.error(chalk.red(`Error: File not found: ${originalPath}`));
        process.exit(1);
      }

      let publicKeyHex = '';
      try {
        publicKeyHex = resolvePublicKeyHex(String(options.pubkey || '').trim());
      } catch (error: any) {
        console.error(chalk.red(`Error: ${error.message}`));
        process.exit(1);
      }

      const spinner = ora('Verifying OTA file...').start();

      try {
        const result = verifyOta(signedPath, originalPath, publicKeyHex);
        spinner.succeed(chalk.green('Verification completed.'));
        const overall =
          result.mark_ok &&
          result.compressed_hash_match &&
          result.compressed_signature_ok === true &&
          (!originalPath || (result.original_hash_match === true && result.original_signature_ok === true));

        console.log('');
        console.log(chalk.cyan('  Result:'));
        console.log(chalk.white(`  mark_ok: ${result.mark_ok ? 'OK' : 'FAIL'}`));
        console.log(chalk.white(`  compressed_hash_match: ${result.compressed_hash_match ? 'OK' : 'FAIL'}`));
        console.log(
          chalk.white(
            `  compressed_signature_ok: ${result.compressed_signature_ok === null ? 'N/A' : result.compressed_signature_ok ? 'OK' : 'FAIL'}`
          )
        );
        console.log(
          chalk.white(
            `  original_hash_match: ${result.original_hash_match === null ? 'N/A' : result.original_hash_match ? 'OK' : 'FAIL'}`
          )
        );
        console.log(
          chalk.white(
            `  original_signature_ok: ${result.original_signature_ok === null ? 'N/A' : result.original_signature_ok ? 'OK' : 'FAIL'}`
          )
        );
        console.log('');
        console.log(overall ? chalk.green('  Overall: PASS') : chalk.red('  Overall: FAIL'));
        console.log('');
      } catch (error: any) {
        spinner.fail(chalk.red(`Verification failed: ${error.message}`));
      }
    });
}