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
        await device.connect();
        spinner.succeed('Device connected');
        
        spinner.start('Getting status...');
        const status = await device.getStatus();
        spinner.succeed('Status retrieved');
        
        console.log(chalk.green('\n✓ Device Information:'));
        
        if (status.tlvArray && status.tlvArray.length > 0) {
          status.tlvArray.forEach((tlv: any) => {
            let label = 'Unknown';
            let value = tlv.value ? tlv.value.toString('utf8').replace(/\0/g, '') : '';
            
            switch(tlv.type) {
              case 1: label = 'Model'; break;
              case 2: label = 'Serial Number'; break;
              case 3: label = 'Hardware Version'; break;
              case 4: label = 'Firmware Version'; break;
              case 5: label = 'Boot Version'; break;
              default: label = `Type ${tlv.type}`;
            }
            
            console.log(chalk.gray(`  ${label}: ${chalk.white(value)}`));
          });
        } else {
          console.log(chalk.yellow('  No device information available'));
        }
        
        console.log(chalk.green(`\n  Protocol Status: ${status.statusMessage}`));
        
        await device.disconnect();
        
      } catch (error: any) {
        spinner.fail(chalk.red('Failed to get status'));
        console.error(chalk.red('\n✗ Error:'), error.message);
        process.exit(1);
      }
    });
}