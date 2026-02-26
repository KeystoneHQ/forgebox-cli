import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { UsbManager } from '../lib/usb-manager';

export function registerStatusCommand(program: Command) {
  program
    .command('status')
    .description('Get ForgeBox device status')
    .action(async () => {
      const spinner = ora('Searching for device...').start();
      
      try {
        const device = await UsbManager.findDevice();
        // device is already connected by UsbManager.findDevice()
        // await device.connect(); 
        
        spinner.start('Getting status...');
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
        process.exit(0);
      } catch (error: any) {
        spinner.fail('Failed to get status');
        console.error(error instanceof Error ? error.message : JSON.stringify(error));
        if (process.env.DEBUG) console.error(error);
        process.exit(1);
      }
    });
}