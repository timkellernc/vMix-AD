const Jimp = require('jimp');

async function removeBackground() {
  const imagePath = 'build/icon.png';
  const image = await Jimp.read(imagePath);
  
  const width = image.bitmap.width;
  const height = image.bitmap.height;
  
  // Use top-left pixel as reference background color
  const bgColor = image.getPixelColor(0, 0);
  const targetR = Jimp.intToRGBA(bgColor).r;
  const targetG = Jimp.intToRGBA(bgColor).g;
  const targetB = Jimp.intToRGBA(bgColor).b;
  
  const tolerance = 30; // Color distance tolerance
  
  const visited = new Uint8Array(width * height);
  const queue = [{x: 0, y: 0}, {x: width - 1, y: 0}, {x: 0, y: height - 1}, {x: width - 1, y: height - 1}];
  
  while (queue.length > 0) {
    const {x, y} = queue.pop();
    
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    
    const idx = y * width + x;
    if (visited[idx]) continue;
    visited[idx] = 1;
    
    const pixelColor = image.getPixelColor(x, y);
    const rgba = Jimp.intToRGBA(pixelColor);
    
    if (Math.abs(rgba.r - targetR) <= tolerance && 
        Math.abs(rgba.g - targetG) <= tolerance && 
        Math.abs(rgba.b - targetB) <= tolerance) {
      
      // Make it transparent
      image.setPixelColor(0x00000000, x, y);
      
      // Add neighbors to queue
      queue.push({x: x + 1, y});
      queue.push({x: x - 1, y});
      queue.push({x, y: y + 1});
      queue.push({x, y: y - 1});
    }
  }

  // Smooth the edges by finding transparent pixels that touch non-transparent pixels
  // and giving them semi-transparency for a clean edge
  const tempImage = image.clone();
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const rgba = Jimp.intToRGBA(tempImage.getPixelColor(x, y));
      if (rgba.a !== 0) continue;
      
      let solidNeighbors = 0;
      if (Jimp.intToRGBA(tempImage.getPixelColor(x+1, y)).a > 0) solidNeighbors++;
      if (Jimp.intToRGBA(tempImage.getPixelColor(x-1, y)).a > 0) solidNeighbors++;
      if (Jimp.intToRGBA(tempImage.getPixelColor(x, y+1)).a > 0) solidNeighbors++;
      if (Jimp.intToRGBA(tempImage.getPixelColor(x, y-1)).a > 0) solidNeighbors++;
      
      if (solidNeighbors > 0) {
        // Find average color of solid neighbors
        let r=0, g=0, b=0, count=0;
        const neighbors = [
          Jimp.intToRGBA(tempImage.getPixelColor(x+1, y)),
          Jimp.intToRGBA(tempImage.getPixelColor(x-1, y)),
          Jimp.intToRGBA(tempImage.getPixelColor(x, y+1)),
          Jimp.intToRGBA(tempImage.getPixelColor(x, y-1))
        ];
        neighbors.forEach(n => {
          if (n.a > 0) { r+=n.r; g+=n.g; b+=n.b; count++; }
        });
        
        image.setPixelColor(Jimp.rgbaToInt(r/count, g/count, b/count, 128), x, y);
      }
    }
  }

  await image.writeAsync('build/icon.png');
  console.log('Background removed perfectly via flood fill!');
}

removeBackground().catch(console.error);
