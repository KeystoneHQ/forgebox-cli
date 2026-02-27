import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import chalk from 'chalk';
import ora from 'ora';

export function registerBuildCommand(program: Command) {
  program
    .command('build:firmware [source]')
    .description('Build firmware from source code')
    .option('-o, --out <directory>', 'Output directory for built firmware', './my-firmware')
    .addHelpText('after', `
Examples:
  $ forgebox build:firmware ./keystone3-firmware
  $ forgebox build:firmware . -o ./dist
`)
    .action(async (source, options) => {
        // 1. Determine source directory
        const sourceDir = source ? path.resolve(process.cwd(), source) : process.cwd();
        const buildScript = path.join(sourceDir, 'build.py');
        
        if (!fs.existsSync(buildScript)) {
            console.error(chalk.red(`Error: build.py not found in ${sourceDir}`));
            console.error(chalk.yellow('Please provide the path to the keystone3-firmware repository root.'));
            process.exit(1);
        }

        // 2. Prepare output directory
        const outputDir = path.resolve(process.cwd(), options.out);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        console.log(chalk.blue(`Source: ${sourceDir}`));
        console.log(chalk.blue(`Output: ${outputDir}`));
        
        // 3. Execute build command
        const spinner = ora('Compiling firmware (python3 build.py -e production)...').start();
        
        const buildProcess = spawn('python3', ['build.py', '-e', 'production'], {
            cwd: sourceDir,
            // Inherit stdio to show build progress in real-time if verbose, 
            // or pipe to capture and show only on error.
            // For long builds, users might prefer to see output? 
            // Let's use pipe and only show on error to keep UI clean, 
            // or maybe add a --verbose flag.
            stdio: 'pipe' 
        });

        let stdoutLog = '';
        let stderrLog = '';

        buildProcess.stdout.on('data', (data) => {
            stdoutLog += data.toString();
            // Optional: update spinner text with last line?
            // spinner.text = `Compiling: ${data.toString().trim().slice(0, 50)}...`;
        });

        buildProcess.stderr.on('data', (data) => {
            stderrLog += data.toString();
        });

        buildProcess.on('close', (code) => {
            if (code === 0) {
                spinner.succeed('Firmware compiled successfully!');
                
                // 4. Copy firmware file
                // Expected output: build/mh1903.bin
                const builtFile = path.join(sourceDir, 'build', 'mh1903.bin');
                const targetFile = path.join(outputDir, 'mh1903_full.bin');
                
                if (fs.existsSync(builtFile)) {
                    fs.copyFileSync(builtFile, targetFile);
                    console.log(chalk.green(`\n✔ Firmware saved to: ${targetFile}`));
                    console.log(chalk.gray('\nYou can now sign this firmware using:'));
                    console.log(chalk.yellow(`  forgebox sign --file ${targetFile} --key <private.pem>`));
                } else {
                    spinner.warn(chalk.yellow(`Warning: Build succeeded but output file not found at ${builtFile}`));
                    console.log(chalk.gray('Please check the build output folder manually.'));
                }
            } else {
                spinner.fail(`Firmware build failed with code ${code}.`);
                console.error(chalk.red('\n--- Build Error Log ---'));
                console.error(stderrLog || stdoutLog); // Prefer stderr, fallback to stdout
                process.exit(1);
            }
        });
        
        buildProcess.on('error', (err) => {
            spinner.fail('Failed to start build process.');
            console.error(chalk.red(err.message));
            console.error(chalk.yellow('Make sure python3 is installed and added to your PATH.'));
            process.exit(1);
        });
    });
}
