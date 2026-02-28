# ForgeBox CLI

ForgeBox Hardware Wallet Management Tool. This tool is used for generating secure credentials, managing hardware device public key registration, and executing firmware signing.

## Features

- **list-devices**: List all connected USB devices.
- **status**: Get detailed device information (firmware version, serial number, etc.).
- **keygen**: Generate secp256k1 standard public/private key pairs (PEM format).
- **register**: Write the public key to the ForgeBox hardware device, supporting user Swipe-to-Confirm.
- **build:firmware**: Compile firmware source code.
- **sign**: Perform OTA signature packaging for firmware.
- **interactive** (alias `i`): Launch an interactive menu mode supporting all common operations.

## Installation & Build

```bash
# Install dependencies
npm install

# Compile and register global command
npm run build
```

After executing `npm run build`, the CLI tool will be automatically registered to the system path, allowing you to use the `forgebox` command directly without specifying a relative path.

## Usage Guide

### 1. List Devices (List Devices)

List information for all currently connected USB devices.

```bash
forgebox list-devices
```

**Output Example:**
```
Found 1 device(s):

Product                        Manufacturer         Serial               VID     PID     
--------------------------------------------------------------------------------------
ForgeBox                 Keystone             M-KYTJ69ND           0x1209  0x3001  
```

### 2. View Device Status (Status)

Get detailed status information of the connected device, including model, serial number, firmware version, etc.

```bash
forgebox status
```

**Output Example:**
```
✓ Device Information:
  Model: ForgeBox
  Firmware Version: 12.2.10
  Hardware Version: v2.0
  Serial Number: M-KYTJ69ND

  Protocol Status: Connected
```

### 3. Generate Credentials (Keygen)

Generate a public/private key pair compliant with the secp256k1 standard.

```bash
forgebox keygen --out <output_directory>
```

**Example:**
```bash
forgebox keygen --out ./my-keys
```
*Output:* Generates `private.pem` (private key) and `pubkey.pem` (public key) in the `./my-keys` directory.

> ⚠️ **Note**: Please keep `private.pem` secure. Leaking the private key poses a security risk.

### 4. Register Public Key (Register)

Write the public key to the ForgeBox hardware device. For security, this process requires the corresponding private key to generate a "Proof of Possession".

**Method 1: Specify Directory (Recommended)**
Automatically reads `pubkey.pem` and `private.pem` from the directory.
```bash
forgebox register ./my-keys
```

**Method 2: Manually Specify Files**
```bash
forgebox register --pubkey ./my-keys/pubkey.pem --key ./my-keys/private.pem
```

**Interaction Flow:**
1. CLI verifies the public/private key pair match and generates a proof of possession signature.
2. CLI automatically searches for and connects to the USB device.
3. The terminal displays the public key fingerprint (SHA256), prompting the user to compare it with the content displayed on the device screen.
4. **User Action**: After verifying the fingerprint on the hardware device, swipe the screen to confirm writing.
5. The device validates the signature and saves the public key upon confirmation.

### 5. Build Firmware (Build Firmware)

Use the CLI tool to compile firmware source code.

**Prerequisites:**
1. Local environment has `python3` installed.
2. Cross-compilation toolchain required for firmware compilation is installed (e.g., `arm-none-eabi-gcc`, refer to the firmware repository documentation for details).

```bash
# 1. Clone firmware source code
git clone https://github.com/keystonehq/forgebox-firmware.git

# 2. Execute build command
forgebox build:firmware ./forgebox-firmware
```

**Parameters:**
- `[source]`: Firmware source code directory path (default: current directory).
- `-o, --out <directory>`: Output directory for build artifacts (default: `./my-firmware`).

**Example:**
```bash
forgebox build:firmware ./forgebox-firmware -o ./my-firmware
```
This command automatically invokes the `build.py` script in the source directory to execute compilation and copies the generated `mh1903_full.bin` to the specified output directory.

**Alternative: Manual Build**

If you prefer to operate within the firmware project, you can also run the build script directly in the `forgebox-firmware` directory:

```bash
cd forgebox-firmware
python3 build.py -e production
```

After successful compilation, the generated firmware file is located at `build/mh1903_full.bin`. You need to copy it out for easier identification and then use `forgebox sign` to sign it.

### 6. Firmware Signing (Sign)

Process the firmware file into an OTA signature package ready for upgrade.

```bash
forgebox sign --s <source_firmware_file> --d <signed_file> --key <private_key_file_or_hex>
```

**Parameters:**
- `--s`: Path to the source firmware file to be signed (e.g., `mh1903_full.bin` generated in the previous step)
- `--d`: Path for the output signed OTA file
- `--key`: Path to the private key file (PEM) or a 64-character private key hex string

**Example:**
```bash
# Sign using a private key file
forgebox sign --s ./my-firmware/mh1903_full.bin --d ./my-firmware/forgebox.bin --key ./my-keys/private.pem

# Sign using a private key hex string
forgebox sign --s ./my-firmware/mh1903_full.bin --d ./my-firmware/forgebox.bin --key your_private_key_hex
```

**Execution Logic:**
1. CLI compresses and chunks the firmware according to the OTA format.
2. Calculates the SHA256 of the compressed data and the original data.
3. Signs the hash using the private key and writes it to the header.
4. Outputs an OTA file ready for direct upgrade.

### 7. Interactive Mode (Interactive)

Launch the interactive menu to easily perform common operations.

```bash
forgebox i
# or
forgebox interactive
```

**Menu Functions:**
- **List Devices**: List connected devices.
- **Get Device Status**: View device details.
- **Generate Key Pair**: Interactively generate a key pair.
- **Register Public Key**: Register a public key (supports loading from file or manual Hex input).
