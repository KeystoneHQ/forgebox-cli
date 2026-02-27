#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { registerKeygenCommand } from './commands/keygen';
import { registerRegisterCommand } from './commands/register';
import { registerSignCommand } from './commands/sign';
import { registerStatusCommand } from './commands/status';
import { registerListDeviceCommand } from './commands/list-device';
import { registerInteractiveCommand } from './commands/interactive';
import { registerBuildCommand } from './commands/build';

// 读取 package.json 获取版本号
// 注意：在 TypeScript 中直接 import json 需要配置 resolveJsonModule
const packageJson = require('../package.json');

const program = new Command();

program
  .name('forgebox')
  .description('CLI tool for ForgeBox Hardware Wallet management')
  .version(packageJson.version);

// 注册命令
registerListDeviceCommand(program);
registerStatusCommand(program);
registerKeygenCommand(program);
registerRegisterCommand(program);
registerSignCommand(program);
registerBuildCommand(program);
registerInteractiveCommand(program);

// 错误处理
program.on('command:*', () => {
  console.error(chalk.red('Invalid command: %s\nSee --help for a list of available commands.'), program.args.join(' '));
  process.exit(1);
});

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
