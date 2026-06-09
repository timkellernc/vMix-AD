# vMix AD (Automated Director)

vMix AD is an Electron-based application designed to bridge the gap between **Rundown Creator** and **vMix**. It serves as an "Automated Director," taking rundown scripts and custom automation prefixes, and seamlessly translating them into live vMix switching commands, media loading, lower-thirds overlays, and audio control.

## 🚀 Features

- **Rundown Creator Integration**: Live syncs with your Rundown Creator API. Automatically pulls in scripts, story slugs, front/back times, and estimated durations.
- **Smart Media Pool Engine**: Dynamically manages a circular buffer (defaulting to 9 slots) of vMix video inputs. As your show progresses, it invisibly preloads upcoming videos in the background and unloads old ones. 
- **Custom Automation Mappings**: Define custom syntax (like `C1`, `M1`, `CG1`) that automatically maps to vMix Inputs, Functions, and Values.
- **Advanced Run Timers**: Calculates live elapsed and remaining times, block times, and dynamically shifts front/back times based on your current pacing compared to the original rundown.
- **Sandbox Automation Tester**: Built-in test sandbox to verify complex mapping strings without affecting the live show.
- **Fully Local & Portable**: Runs locally with minimum overhead and compiles to a portable Windows executable.

## 📦 Installation & Setup

1. **Clone or Download** this repository.
2. Ensure you have **Node.js** installed.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Run the app locally in development mode:
   ```bash
   npm start
   ```

## 🏗️ Building for Production

To build a standalone portable Windows executable (`.exe`):

```bash
npm run build
```
The compiled executable will be located in the `dist` folder.

## ⚙️ Configuration

Once you launch the app, click the **Settings (Gear Icon)** in the top right to configure:
1. **Rundown Creator API Details**: Enter your Station, API Key, and API Token.
2. **Show Directory**: Provide the absolute file path to the local network or physical drive where your media files (MP4, MOV, etc.) are stored. 
3. **vMix IP**: Set the local IP address or `localhost` of your vMix instance.

### Setting Up Automation Mappings
Click the **Automations (Sliders Icon)** in the top right to define mapping groups. 
For example, if your rundown includes the code `C1`, you can map `C` to the vMix function `Cut` targeting the `Camera 1` input. 

## 🛠️ Tech Stack

- **Electron**: Cross-platform desktop framework.
- **Vanilla JS/HTML/CSS**: Fast, lightweight front-end with zero heavy frameworks.
- **get-video-duration** / **FFprobe**: Used for deep media analysis to preload accurate media durations.

## 📝 License

This project is licensed under the [MIT License](LICENSE).
