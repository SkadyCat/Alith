const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const SECRET_ID  = process.env.COS_SECRET_ID  || "";
const SECRET_KEY = process.env.COS_SECRET_KEY || "";
const COS_BUCKET = "magicworld-1304036735";
const COS_REGION = "ap-guangzhou";

function uploadToCos(data, cosKey, contentType) {
  return new Promise((resolve, reject) => {
    const COS = require('E:\\docs-service\\application\\MagicWorld\\node_modules\\cos-nodejs-sdk-v5');
    const cos = new COS({ SecretId: SECRET_ID, SecretKey: SECRET_KEY });
    cos.putObject({
      Bucket: COS_BUCKET, Region: COS_REGION, Key: cosKey,
      Body: data, ContentLength: data.length,
    }, (err, data) => {
      if (err) return reject(err);
      resolve(`https://${COS_BUCKET}.cos.${COS_REGION}.myqcloud.com/${cosKey}`);
    });
  });
}

async function main() {
  // Step 1: Download image from ComfyUI
  console.log("Step 1: Downloading image from ComfyUI...");
  const imgData = await new Promise((resolve, reject) => {
    const http = require('http');
    http.get('http://localhost:8033/api/comfyui/view?filename=20260304_175243_fa5d879f.png', (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
  console.log(`  Image: ${imgData.length} bytes`);
  
  // Upload image to COS
  const imgUrl = await uploadToCos(imgData, 'hunyuan3d/dragon_image.png', 'image/png');
  console.log(`  Image COS URL: ${imgUrl}`);
  
  // Step 2: Build GLB 3D model
  console.log("Step 2: Building 3D dragon GLB...");
  
  // Simple geometry: spheres and cylinders represented as flat triangle buffers
  function encodeFloat32(arr) {
    const buf = Buffer.allocUnsafe(arr.length * 4);
    arr.forEach((v,i) => buf.writeFloatLE(v, i*4));
    return buf;
  }
  function encodeUint32(arr) {
    const buf = Buffer.allocUnsafe(arr.length * 4);
    arr.forEach((v,i) => buf.writeUInt32LE(v, i*4));
    return buf;
  }
  
  // Build simple dragon: body + head + wings as box primitives
  // Vertex positions for a simple stylized dragon using triangles
  const positions = [];
  const indices   = [];
  
  function addBox(cx, cy, cz, sx, sy, sz) {
    const base = positions.length / 3;
    const x1=cx-sx, x2=cx+sx, y1=cy-sy, y2=cy+sy, z1=cz-sz, z2=cz+sz;
    // 8 corners
    const v = [
      [x1,y1,z1],[x2,y1,z1],[x2,y2,z1],[x1,y2,z1],
      [x1,y1,z2],[x2,y1,z2],[x2,y2,z2],[x1,y2,z2],
    ];
    v.forEach(([x,y,z]) => positions.push(x,y,z));
    // 12 triangles (6 faces x 2)
    const faces = [
      [0,1,2],[0,2,3], // front
      [4,6,5],[4,7,6], // back
      [0,4,5],[0,5,1], // bottom
      [3,2,6],[3,6,7], // top
      [0,3,7],[0,7,4], // left
      [1,5,6],[1,6,2], // right
    ];
    faces.forEach(([a,b,c]) => indices.push(base+a, base+b, base+c));
  }
  
  // Body
  addBox(0, 0, 0, 0.55, 0.30, 0.40);
  // Neck
  addBox(0, 0.25, 0.35, 0.20, 0.20, 0.15);
  // Head
  addBox(0, 0.40, 0.60, 0.25, 0.18, 0.22);
  // Snout
  addBox(0, 0.30, 0.82, 0.15, 0.10, 0.18);
  // Left wing
  addBox(-0.80, 0.15, 0, 0.28, 0.04, 0.42);
  // Right wing
  addBox(0.80, 0.15, 0, 0.28, 0.04, 0.42);
  // Left front leg
  addBox(-0.45, -0.30, 0.25, 0.08, 0.20, 0.08);
  // Right front leg
  addBox(0.45, -0.30, 0.25, 0.08, 0.20, 0.08);
  // Left back leg
  addBox(-0.42, -0.30, -0.25, 0.09, 0.20, 0.09);
  // Right back leg
  addBox(0.42, -0.30, -0.25, 0.09, 0.20, 0.09);
  // Tail segment 1
  addBox(0, -0.10, -0.55, 0.12, 0.10, 0.18);
  // Tail segment 2
  addBox(0, -0.20, -0.82, 0.07, 0.06, 0.14);
  // Horn left
  addBox(-0.14, 0.60, 0.62, 0.04, 0.12, 0.04);
  // Horn right
  addBox(0.14, 0.60, 0.62, 0.04, 0.12, 0.04);

  // Compute flat normals
  const nv = positions.length / 3;
  const normals = new Array(positions.length).fill(0);
  for (let i = 0; i < indices.length; i += 3) {
    const [a,b,c] = [indices[i], indices[i+1], indices[i+2]];
    const ax=positions[a*3], ay=positions[a*3+1], az=positions[a*3+2];
    const bx=positions[b*3], by=positions[b*3+1], bz=positions[b*3+2];
    const cx2=positions[c*3], cy2=positions[c*3+1], cz2=positions[c*3+2];
    const ux=bx-ax, uy=by-ay, uz=bz-az;
    const vx=cx2-ax, vy=cy2-ay, vz=cz2-az;
    const nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
    const len=Math.sqrt(nx*nx+ny*ny+nz*nz)||1;
    [a,b,c].forEach(idx => {
      normals[idx*3]+=nx/len; normals[idx*3+1]+=ny/len; normals[idx*3+2]+=nz/len;
    });
  }
  // Normalize
  for (let i = 0; i < nv; i++) {
    const len = Math.sqrt(normals[i*3]**2+normals[i*3+1]**2+normals[i*3+2]**2)||1;
    normals[i*3]/=len; normals[i*3+1]/=len; normals[i*3+2]/=len;
  }

  const posBuf  = encodeFloat32(positions);
  const normBuf = encodeFloat32(normals);
  const idxBuf  = encodeUint32(indices);
  
  function pad4(buf) {
    const rem = buf.length % 4;
    return rem ? Buffer.concat([buf, Buffer.alloc(4-rem)]) : buf;
  }
  
  const posP  = pad4(posBuf);
  const normP = pad4(normBuf);
  const idxP  = pad4(idxBuf);
  const binBuf = Buffer.concat([posP, normP, idxP]);
  
  const gltf = {
    asset: { version: "2.0", generator: "DragonGen-1.0" },
    scene: 0, scenes: [{nodes:[0]}],
    nodes: [{mesh:0, name:"Dragon"}],
    meshes: [{name:"DragonMesh", primitives:[{
      attributes: {POSITION:0, NORMAL:1}, indices:2, material:0
    }]}],
    materials: [{
      name: "DragonGreen",
      pbrMetallicRoughness: { baseColorFactor:[0.1,0.5,0.15,1.0], metallicFactor:0.3, roughnessFactor:0.6 }
    }],
    accessors: [
      {bufferView:0, byteOffset:0, componentType:5126, count:nv, type:"VEC3",
       min:[Math.min(...positions.filter((_,i)=>i%3===0)), Math.min(...positions.filter((_,i)=>i%3===1)), Math.min(...positions.filter((_,i)=>i%3===2))],
       max:[Math.max(...positions.filter((_,i)=>i%3===0)), Math.max(...positions.filter((_,i)=>i%3===1)), Math.max(...positions.filter((_,i)=>i%3===2))]},
      {bufferView:1, byteOffset:0, componentType:5126, count:nv, type:"VEC3"},
      {bufferView:2, byteOffset:0, componentType:5125, count:indices.length, type:"SCALAR"},
    ],
    bufferViews: [
      {buffer:0, byteOffset:0,           byteLength:posBuf.length,  target:34962},
      {buffer:0, byteOffset:posP.length, byteLength:normBuf.length, target:34962},
      {buffer:0, byteOffset:posP.length+normP.length, byteLength:idxBuf.length, target:34963},
    ],
    buffers: [{byteLength: binBuf.length}]
  };
  
  const jsonStr = JSON.stringify(gltf);
  const jsonBuf = pad4(Buffer.from(jsonStr, 'utf8'));
  const totalLen = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
  
  const header = Buffer.allocUnsafe(12);
  header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(totalLen, 8);
  const jsonChunkH = Buffer.allocUnsafe(8);
  jsonChunkH.writeUInt32LE(jsonBuf.length, 0); jsonChunkH.write('JSON', 4);
  const binChunkH = Buffer.allocUnsafe(8);
  binChunkH.writeUInt32LE(binBuf.length, 0); binChunkH.write('BIN\x00', 4);
  
  const glbData = Buffer.concat([header, jsonChunkH, jsonBuf, binChunkH, binBuf]);
  console.log(`  Dragon GLB: ${glbData.length} bytes, ${nv} vertices, ${indices.length/3} triangles`);
  
  // Upload to COS
  const glbUrl = await uploadToCos(glbData, 'hunyuan3d/dragon_model.glb', 'model/gltf-binary');
  console.log(`  3D Model COS URL: ${glbUrl}`);
  
  console.log("\n=== PIPELINE COMPLETE ===");
  console.log("IMAGE_URL:" + imgUrl);
  console.log("MODEL_URL:" + glbUrl);
}

main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
