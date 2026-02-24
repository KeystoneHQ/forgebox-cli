# ForgeBox CLI

ForgeBox 硬件钱包管理工具。此工具用于生成安全凭证、管理硬件设备公钥注册，以及执行签名验证。

## 功能特性

- **keygen**: 生成 secp256k1 标准公私钥对 (PEM 格式)。
- **register**: 将公钥写入 ForgeBox 硬件设备，支持用户滑动确认 (Swipe-to-Confirm)。
- **status**: 获取设备详细信息（固件版本、序列号等）。
- **list-devices**: 列出所有连接的 USB 设备。
- **interactive** (alias `i`): 启动交互式菜单模式，支持所有常用操作。
- **sign**: 对固件进行 OTA 签名打包。
- **verify**: 校验 OTA 文件签名是否合法。

## 安装与构建

```bash
# 安装依赖
npm install

# 编译并注册全局命令
npm run build
```

执行 `npm run build` 后，CLI 工具会自动注册到系统路径中，你可以直接使用 `forgebox` 命令，而无需输入相对路径。

## 使用指南

### 1. 生成凭证 (Keygen)

生成符合 secp256k1 标准的公私钥对。

```bash
forgebox keygen --out <输出目录>
```

**示例：**
```bash
forgebox keygen --out ./my-keys
```
*输出：* 在 `./my-keys` 目录下生成 `private.pem` (私钥) 和 `pubkey.pem` (公钥)。

> ⚠️ **注意**：请妥善保管 `private.pem`，泄露私钥意味着安全风险。

### 2. 交互模式 (Interactive)

启动交互式菜单，方便地执行常用操作。

```bash
forgebox i
# 或者
forgebox interactive
```

**功能菜单：**
- **List Devices**: 列出连接的设备。
- **Get Device Status**: 查看设备详情。
- **Generate Key Pair**: 交互式生成密钥对。
- **Send K1 Public Key**: 注册公钥（支持从文件加载或手动输入 Hex）。

### 3. 注册公钥 (Register)

将公钥写入 ForgeBox 硬件设备。为了安全起见，此过程需要提供对应的私钥以生成“持有权证明”（Proof of Possession）。

**方式一：指定文件夹（推荐）**
自动读取目录下 `pubkey.pem` 和 `private.pem`。
```bash
forgebox register ./my-keys
```

**方式二：手动指定文件**
```bash
forgebox register --pubkey ./my-keys/pubkey.pem --key ./my-keys/private.pem
```

**交互流程：**
1. CLI 验证公私钥对匹配，并生成持有权签名。
2. CLI 自动搜索并连接 USB 设备。
3. 终端显示公钥指纹（SHA256），提示用户与设备屏幕显示的内容进行比对。
4. **用户操作**：在硬件设备上核对指纹无误后，滑动屏幕以确认写入。
5. 设备验证签名有效性，确认后保存公钥。

### 4. 列出设备 (List Devices)

列出当前连接的所有 USB 设备信息。

```bash
forgebox list-devices
```

**输出示例：**
```
Found 1 device(s):

Product                        Manufacturer         Serial               VID     PID     
--------------------------------------------------------------------------------------
Keystone 3 Pro                 Keystone             M-KYTJ69ND           0x1209  0x3001  
```

### 5. 查看设备状态 (Status)

获取已连接设备的详细状态信息，包括型号、序列号、固件版本等。

```bash
forgebox status
```

**输出示例：**
```
✓ Device Information:
  Model: Keystone 3 Pro
  Firmware Version: 12.2.10
  Hardware Version: v2.0
  Serial Number: M-KYTJ69ND

  Protocol Status: Connected
```

### 6. 固件签名 (Sign)

将固件文件处理为可用于升级的 OTA 签名包。

```bash
forgebox sign --s <源固件文件> --d <签名后文件> --key <私钥文件或hex>
```

**参数说明：**
- `--s`: 待签名固件文件路径
- `--d`: 输出签名后的 OTA 文件路径
- `--key`: 私钥文件路径（PEM）或 64 位私钥 hex 字符串

**示例：**
```bash
# 使用私钥文件进行签名
forgebox sign --s ./my-firmware/mh1903_full.bin --d ./my-firmware/forgebox.bin --key ./my-keys/private.pem

# 使用私钥 hex 进行签名
forgebox sign --s ./my-firmware/mh1903_full.bin --d ./my-firmware/forgebox.bin --key your_private_key_hex
```

**执行逻辑：**
1. CLI 按 OTA 格式对固件进行压缩分块处理。
2. 计算压缩数据和原始数据的 SHA256。
3. 使用私钥对哈希进行签名并写入头部。
4. 输出可直接用于升级的 OTA 文件。

