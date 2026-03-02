import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import { CryptoManager } from '../lib/crypto';

export function registerKeygenCommand(program: Command) {
  program
    .command('keygen')
    .description('Generate a new secp256k1 key pair')
    .option('-o, --out <directory>', 'Output directory for keys', './my-keys')
    .addHelpText('after', `

Examples:
  $ forgebox keygen --out ./my-keys
  $ forgebox keygen -o ./secure-storage
`)
    .action(async (options) => {
      const spinner = ora('Generating key pair...').start();

      try {
        const outputDir = path.resolve(process.cwd(), options.out);
        
        // Ensure directory exists
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        // Generate key pair
        const keys = CryptoManager.generateKeyPair();
        

        // Save files
        const { pubPath, privPath } = CryptoManager.saveKeys(keys, outputDir);

        spinner.succeed(chalk.green('Key pair generated successfully!'));
        console.log('');
        console.log(`  ${chalk.cyan('Private Key:')} ${privPath}`);
        console.log(`  ${chalk.cyan('Public Key:')}  ${pubPath}`);
        console.log('');
        console.log(chalk.yellow('  ⚠️  Keep your private key safe!'));
        
      } catch (error) {
        spinner.fail(chalk.red('Failed to generate keys'));
        console.error(error);
      }
    });
}
