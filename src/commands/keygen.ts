import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import chalk from 'chalk';
import ora from 'ora';
import { CryptoManager } from '../lib/crypto';

const DEFAULT_KEY_DIR = path.join(os.homedir(), '.forgebox', 'keys');

function isInsideGitRepo(dir: string): boolean {
  let cur = path.resolve(dir);
  while (cur !== path.dirname(cur)) {
    if (fs.existsSync(path.join(cur, '.git'))) return true;
    cur = path.dirname(cur);
  }
  return false;
}

export function registerKeygenCommand(program: Command) {
  program
    .command('keygen')
    .description('Generate a new secp256k1 key pair')
    .option('-o, --out <directory>', 'Output directory for keys', DEFAULT_KEY_DIR)
    .option('-f, --force', 'Allow writing keys into a git working tree (not recommended)')
    .addHelpText('after', `

Examples:
  $ forgebox keygen                        # writes to ~/.forgebox/keys
  $ forgebox keygen --out ./secure-storage
`)
    .action(async (options) => {
      const outputDir = path.resolve(process.cwd(), options.out);

      if (isInsideGitRepo(outputDir) && !options.force) {
        console.error(chalk.red(
          `\nRefusing to write keys into a git working tree:\n  ${outputDir}\n`
        ));
        console.error(chalk.yellow(
          'A committed private key is equivalent to publishing it.\n' +
          'Re-run with -o pointing outside any repo (default: ~/.forgebox/keys),\n' +
          'or pass --force if you accept the risk.'
        ));
        process.exit(1);
      }

      const spinner = ora('Generating key pair...').start();

      try {
        const keys = CryptoManager.generateKeyPair();
        const { pubPath, privPath } = CryptoManager.saveKeys(keys, outputDir);

        spinner.succeed(chalk.green('Key pair generated.'));
        console.log('');
        console.log(`  ${chalk.cyan('Private Key:')} ${privPath} ${chalk.gray('(0600)')}`);
        console.log(`  ${chalk.cyan('Public Key: ')} ${pubPath}`);
        console.log('');
        console.log(chalk.yellow('  ⚠  This private key is the ONLY thing that can sign firmware'));
        console.log(chalk.yellow('     for your device after you register the matching public key.'));
        console.log(chalk.yellow('  ⚠  The device accepts ONE public-key registration per lifetime.'));
        console.log(chalk.yellow('  ⚠  Back up both files to offline storage BEFORE running'));
        console.log(chalk.yellow('     `forgebox register`. Do not copy them into any project dir.'));
        console.log('');
      } catch (error) {
        spinner.fail(chalk.red('Failed to generate keys'));
        console.error(error);
        process.exit(1);
      }
    });
}
