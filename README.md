# ForgeBox CLI

ForgeBox CLI is a developer tool for managing ForgeBox devices, generating signing keys, registering device public keys, building firmware, and producing signed OTA packages.

## Features

- **list-devices**: Show all connected USB devices.
- **status**: Display detailed device information such as firmware version and serial number.
- **keygen**: Generate a secp256k1 key pair in PEM format.
- **register**: Register a public key on a ForgeBox device with on-device confirmation.
- **build:firmware**: Build firmware from source.
- **sign**: Package firmware into a signed OTA image.
- **interactive** (alias `i`): Launch an interactive menu for common workflows.

## Installation

### Install from npm

```bash
# Install globally
npm install -g forgebox-cli

# Verify installation
forgebox --version
forgebox --help
```

You can also run it without global installation:

```bash
npx forgebox-cli --help
```

### Local development

```bash
# Install dependencies
npm install

# Compile and register global command locally
npm run dev
```

After `npm run dev`, the CLI is linked into your local PATH so you can run `forgebox` directly during development.

## Usage

### 1. List connected devices

List all currently connected USB devices.

```bash
forgebox list-devices
```

**Example output:**
```
Found 1 device(s):

Product                        Manufacturer         Serial               VID     PID     
--------------------------------------------------------------------------------------
ForgeBox                 Keystone             M-KYTJ69ND           0x1209  0x3001  
```

### 2. View device status

Display detailed information about the connected device, including the model, serial number, and firmware version.

```bash
forgebox status
```

**Example output:**
```
✓ Device Information:
  Model: ForgeBox
  Firmware Version: 12.2.10
  Hardware Version: v2.0
  Serial Number: M-KYTJ69ND

  Protocol Status: Connected
```

### 3. Generate a key pair

Generate a secp256k1 public/private key pair.

```bash
forgebox keygen
```

By default, keys are written to `~/.forgebox/keys/`:

- `~/.forgebox/keys/private.pem` (mode `0600`)
- `~/.forgebox/keys/pubkey.pem` (mode `0644`)

The containing directory is created with mode `0700`.

**Options:**
- `-o, --out <directory>`: override the output directory.
- `-f, --force`: allow writing keys into a git working tree (not recommended — see below).

**Examples:**
```bash
# Default: ~/.forgebox/keys
forgebox keygen

# Custom location outside any repo
forgebox keygen --out ~/secure-storage
```

**Safety:**
- `keygen` refuses to write into a git working tree. A committed private key is equivalent to publishing it. Pass `--force` only if you understand the risk, and make sure `*.pem` is in your `.gitignore`.
- Back up both `private.pem` and `pubkey.pem` to offline storage **before** running `forgebox register`. The device accepts **one** public-key registration per lifetime — losing the private key means you cannot sign firmware for that device again.
- Never paste the private key on the command line or into chat tools.

### 4. Register a public key

Register a public key on the ForgeBox device. For security, the CLI uses the matching private key to generate a proof-of-possession signature.

**Option 1: Pass a key directory**

The CLI reads `pubkey.pem` and `private.pem` from the given directory.

```bash
forgebox register ~/.forgebox/keys
```

**Option 2: Pass the key files explicitly**

```bash
forgebox register --pubkey ~/.forgebox/keys/pubkey.pem --key ~/.forgebox/keys/private.pem
```

**Registration flow:**
1. The CLI verifies that the key pair matches and generates a proof-of-possession signature.
2. It discovers and connects to the ForgeBox device over USB.
3. It prints the public key fingerprint as a SHA-256 hash.
4. Compare that fingerprint with the one shown on the device.
5. If they match, confirm on the device by swiping.
6. The device validates the signature and stores the public key.

### 5. Build firmware

Build firmware from the ForgeBox firmware source tree.

**Prerequisites:**
1. `python3` is installed locally.
2. The firmware cross-compilation toolchain is installed, such as `arm-none-eabi-gcc`. Refer to the firmware repository for setup details.

```bash
# 1. Clone firmware source code
git clone https://github.com/KeystoneHQ/forgebox-helloworld.git

# 2. Execute build command
forgebox build:firmware ./forgebox-helloworld
```

**Parameters:**
- `[source]`: Path to the firmware source directory. Defaults to the current directory.
- `-o, --out <directory>`: Output directory for build artifacts (default: `./my-firmware`).

**Example:**
```bash
forgebox build:firmware ./forgebox-helloworld -o ./my-firmware
```
This command runs `build.py` in the source directory and copies the generated firmware image to the output directory as `mh1903_full.bin`.

**Alternative: build manually inside the firmware repository**

If you prefer to work directly in the firmware repository, run the build script there:

```bash
cd forgebox-helloworld
python3 build.py -e production
```

After the build completes, the firmware artifact is located in the build output directory. Copy it to a convenient location if needed, then use `forgebox sign` to create a signed OTA package.

### 6. Sign firmware

Convert a firmware binary into a signed OTA package ready for upgrade.

```bash
forgebox sign --s <source_firmware_file> --d <signed_file> --key <private_key_pem_file>
```

**Parameters:**
- `--s`: Path to the source firmware file, such as `mh1903_full.bin`
- `--d`: Path to the output OTA package
- `--key`: Path to a private key file in PEM format (required)

**Example:**
```bash
forgebox sign --s ./my-firmware/mh1903_full.bin \
              --d ./my-firmware/forgebox.bin \
              --key ~/.forgebox/keys/private.pem
```

> For security, `sign` only accepts a PEM private key file path.

**What the command does:**
1. Compresses and chunks the firmware according to the OTA format.
2. Calculates SHA-256 hashes for the compressed data and the original firmware.
3. Signs the required hash with the private key and writes the signature into the OTA header.
4. Writes an OTA package that can be used directly for device upgrades.

### 7. Interactive mode

Launch an interactive menu for the most common operations.

```bash
forgebox i
# or
forgebox interactive
```

**Available actions:**
- **List Devices**: Show connected devices.
- **Get Device Status**: Show detailed device information.
- **Generate Key Pair**: Generate a key pair interactively.
- **Register Public Key**: Register a public key from PEM files.
