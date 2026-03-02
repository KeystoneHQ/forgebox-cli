import { Command } from 'commander';
import chalk from 'chalk';
import { UsbManager } from '../lib/usb-manager';

export function registerListDeviceCommand(program: Command) {
  program
    .command('list-devices')
    .description('List all connected USB devices')
    .action(async () => {
      console.log(chalk.blue('Scanning for USB devices...'));
      
      try {
        const devices = await UsbManager.listDevices();
        
        if (devices.length === 0) {
          console.log(chalk.yellow('No USB devices found.'));
          return;
        }

        console.log(chalk.green(`\nFound ${devices.length} device(s):\n`));
        
        // Simple table output
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

      } catch (error: any) {
        console.error(chalk.red('\n✗ Error scanning devices:'), error.message);
        process.exit(1);
      }
    });
}