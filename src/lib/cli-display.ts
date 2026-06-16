import chalk from 'chalk';
import { CryptoManager } from './crypto';

const publicKeyHighlight = chalk.hex('#f5a623');

export function formatHighlightedDeviceDisplayPublicKeyHex(publicKey: Buffer): string {
  const groups = CryptoManager.getDeviceDisplayPublicKeyHexGroups(publicKey);
  const highlightedGroups = groups.map((group, index) => {
    if (index < 2 || index >= groups.length - 2) {
      return publicKeyHighlight.bold(group);
    }

    return group;
  });
  const lines: string[] = [];

  for (let i = 0; i < highlightedGroups.length; i += 16) {
    lines.push(highlightedGroups.slice(i, i + 16).join(' '));
  }

  return lines.join('\n  ');
}
