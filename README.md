# ForgeBox CLI

ForgeBox hardware wallet management tool. This tool is used to generate secure credentials, manage hardware device public key registration, and perform signature verification.

## Features

- **keygen**: Generate secp256k1 public/private key pair (PEM format).
- **register**: Write the public key to the ForgeBox hardware device, with Swipe-to-Confirm support.
- **status**: Get device details (firmware version, serial number, etc.).
- **list-devices**: List all connected USB devices.
- **interactive** (alias `i`): Start interactive menu mode with common operations.
- **sign**: Package firmware into an OTA-signed file.

## Installation & Build

```bash
# Install dependencies
npm install

# Build and register the global command
npm run build
```

After running `npm run build`, the CLI will be registered globally, so you can use the `forgebox` command directly without a relative path.

## Usage Guide

### 1. Generate Credentials (Keygen)

Generate secp256k1 public/private key pair.

```bash
forgebox keygen --out <output_dir>
```

**Example:**
```bash
forgebox keygen --out ./my-keys
```

*Output:* Generates `private.pem` (private key) and `pubkey.pem` (public key) under `./my-keys`.

> ⚠️ **Note**: Please keep `private.pem` secure. Leaking the private key is a security risk.

### 2. Interactive Mode (Interactive)

Start the interactive menu for common operations.

```bash
forgebox i
# or
forgebox interactive
```

**Menu Options:**
- **List Devices**: List connected devices.
- **Get Device Status**: View device details.
- **Generate Key Pair**: Generate a key pair interactively.
- **Send K1 Public Key**: Register a public key (load from file or input Hex manually).

### 3. Register Public Key (Register)

Write the public key to the ForgeBox hardware device. For security, this process requires the corresponding private key to generate a Proof of Possession.

**Option 1: Specify a folder (recommended)**  
Automatically reads `pubkey.pem` and `private.pem` in the folder.
```bash
forgebox register ./my-keys
```

**Option 2: Specify files manually**
```bash
forgebox register --pubkey ./my-keys/pubkey.pem --key ./my-keys/private.pem
```

**Interactive Flow:**
1. CLI verifies the key pair and generates a proof-of-possession signature.
2. CLI automatically finds and connects to the USB device.
3. Terminal shows the public key fingerprint (SHA256) and prompts the user to compare with the device screen.
4. **User action**: After confirming the fingerprint, swipe on the device to approve.
5. The device verifies the signature and stores the public key.

### 4. List Devices (List Devices)

List all connected USB devices.

```bash
forgebox list-devices
```

**Sample Output:**
```
Found 1 device(s):

Product                        Manufacturer         Serial               VID     PID     
--------------------------------------------------------------------------------------
Keystone 3 Pro                 Keystone             M-KYTJ69ND           0x1209  0x3001  
```

### 5. Device Status (Status)

Get detailed device information such as model, serial number, and firmware version.

```bash
forgebox status
```

**Sample Output:**
```
✓ Device Information:
  Model: Keystone 3 Pro
  Firmware Version: 12.2.10
  Hardware Version: v2.0
  Serial Number: M-KYTJ69ND

  Protocol Status: Connected
```

### 6. Firmware Signing (Sign)

Package firmware into an OTA-signed file.

```bash
forgebox sign --s <source_firmware> --d <signed_output> --key <private_key_file_or_hex>
```

**Options:**
- `--s`: Source firmware file path
- `--d`: Output OTA file path
- `--key`: Private key file (PEM) or 64-hex private key string

**Examples:**
```bash
# Sign with a private key file
forgebox sign --s ./my-firmware/mh1903_full.bin --d ./my-firmware/forgebox.bin --key ./my-keys/private.pem

# Sign with private key hex
forgebox sign --s ./my-firmware/mh1903_full.bin --d ./my-firmware/forgebox.bin --key your_private_key_hex
```

**Execution Logic:**
1. CLI compresses and chunks firmware according to OTA format.
2. Computes SHA256 of compressed data and original data.
3. Signs the hashes and writes them into the header.
4. Outputs an OTA file ready for upgrade.