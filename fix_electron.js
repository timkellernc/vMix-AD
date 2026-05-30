const https = require('https');
const fs = require('fs');
const path = require('path');
const extract = require('extract-zip');

const version = 'v28.0.0';
const platform = 'win32';
const arch = 'x64';
const url = `https://github.com/electron/electron/releases/download/${version}/electron-${version}-${platform}-${arch}.zip`;
const destZip = path.join(__dirname, 'electron.zip');
const electronModulePath = path.join(__dirname, 'node_modules', 'electron');
const distPath = path.join(electronModulePath, 'dist');

console.log(`Downloading Electron ${version} directly...`);

const file = fs.createWriteStream(destZip);
https.get(url, (response) => {
  if (response.statusCode === 302) {
    https.get(response.headers.location, (res) => {
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          console.log('Download complete. Extracting...');
          extractZip();
        });
      });
    });
  } else {
    response.pipe(file);
    file.on('finish', () => {
      file.close(() => {
        console.log('Download complete. Extracting...');
        extractZip();
      });
    });
  }
}).on('error', (err) => {
  console.error("Error downloading:", err);
});

async function extractZip() {
  try {
    if (!fs.existsSync(distPath)) {
      fs.mkdirSync(distPath, { recursive: true });
    }
    
    // Use the extract-zip module that npm install already downloaded
    await extract(destZip, { dir: distPath });
    
    // Write path.txt
    fs.writeFileSync(path.join(electronModulePath, 'path.txt'), 'electron.exe');
    
    // Write dist/version
    fs.writeFileSync(path.join(distPath, 'version'), version.substring(1));
    
    // Clean up zip
    fs.unlinkSync(destZip);
    
    console.log('Electron successfully installed manually!');
  } catch (err) {
    console.error("Error extracting:", err);
  }
}
