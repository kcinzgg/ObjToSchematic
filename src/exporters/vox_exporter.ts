import { BlockMesh } from '../block_mesh';
import { RGBA, RGBAUtil } from '../colour';
import { ASSERT } from '../util/error_util';
import { Vector3 } from '../vector';
import { Voxel } from '../voxel_mesh';
import { IExporter, TStructureExport } from './base_exporter';

/**
 * 实现MagicaVoxel的.vox格式导出
 * 格式规范参考: https://github.com/ephtracy/voxel-model/blob/master/MagicaVoxel-file-format-vox.txt
 */
export class VoxExporter extends IExporter {
    public override getFormatFilter() {
        return {
            name: 'MagicaVoxel',
            extension: 'vox',
        };
    }

    public override export(blockMesh: BlockMesh): TStructureExport {
        const voxData = this._createVoxData(blockMesh);
        // 将Uint8Array转换为Buffer
        return { type: 'single', extension: '.vox', content: Buffer.from(voxData) };
    }

    private _createVoxData(blockMesh: BlockMesh): Uint8Array {
        // 获取体素网格
        const voxelMesh = blockMesh.getVoxelMesh();
        ASSERT(voxelMesh !== undefined, "Voxel mesh is undefined");

        // 从体素网格中获取所有体素
        const voxels = voxelMesh.getVoxels();
        
        // 获取模型的边界
        const bounds = voxelMesh.getBounds();
        const minPos = bounds.min;
        const size = Vector3.sub(bounds.max, bounds.min).add(1);
        
        // 确保模型尺寸不超过VOX格式的最大限制(256x256x256)
        ASSERT(size.x <= 256 && size.y <= 256 && size.z <= 256, 
            `Model size exceeds VOX format limits: ${size.x}x${size.y}x${size.z}`);
        
        // 提取并处理颜色
        const { colorMap, palette } = this._processColors(voxels.map(v => v.colour));
        
        // 创建文件内容
        // 1. 文件头
        const header = new Uint8Array([
            // "VOX " 魔数
            0x56, 0x4F, 0x58, 0x20,
            // 版本号 (150)
            150, 0, 0, 0
        ]);
        
        // 2. MAIN块
        const mainChunk = this._createMainChunk(voxels, minPos, size, colorMap, palette);
        
        // 合并所有数据
        const result = new Uint8Array(header.length + mainChunk.length);
        result.set(header, 0);
        result.set(mainChunk, header.length);
        
        return result;
    }
    
    private _processColors(colors: RGBA[]): { colorMap: Map<string, number>, palette: Uint8Array } {
        // 去重颜色
        const uniqueColors = new Map<string, RGBA>();
        colors.forEach(color => {
            const key = this._colorToKey(color);
            if (!uniqueColors.has(key)) {
                uniqueColors.set(key, color);
            }
        });
        
        // 如果颜色数量超过256，需要进行量化处理
        let finalColors: RGBA[] = Array.from(uniqueColors.values());
        if (finalColors.length > 256) {
            // 简单的颜色量化 - 取前255种最常见的颜色
            // 在实际实现中，应该使用更复杂的量化算法
            console.warn(`Too many colors (${finalColors.length}), truncating to 256`);
            finalColors = finalColors.slice(0, 255);
        }
        
        // 创建色彩映射和调色板
        const colorMap = new Map<string, number>();
        const palette = new Uint8Array(256 * 4);
        
        // 设置默认色(索引0为默认透明色)
        palette[0] = 0;
        palette[1] = 0;
        palette[2] = 0;
        palette[3] = 0;
        
        // 填充调色板
        finalColors.forEach((color, index) => {
            const i = index + 1; // 从1开始，0是透明色
            const key = this._colorToKey(color);
            colorMap.set(key, i);
            
            // RGBA存储顺序(注意VOX使用BGRA存储)
            palette[i * 4] = Math.round(color.b * 255);     // B
            palette[i * 4 + 1] = Math.round(color.g * 255); // G
            palette[i * 4 + 2] = Math.round(color.r * 255); // R
            palette[i * 4 + 3] = Math.round(color.a * 255); // A
        });
        
        return { colorMap, palette };
    }
    
    private _colorToKey(color: RGBA): string {
        return `${Math.round(color.r*255)},${Math.round(color.g*255)},${Math.round(color.b*255)},${Math.round(color.a*255)}`;
    }
    
    private _createMainChunk(
        voxels: Voxel[], 
        minPos: Vector3, 
        size: Vector3, 
        colorMap: Map<string, number>, 
        palette: Uint8Array
    ): Uint8Array {
        // 创建SIZE块
        const sizeChunk = this._createSizeChunk(size);
        
        // 创建XYZI块
        const xyziChunk = this._createXYZIChunk(voxels, minPos, colorMap);
        
        // 创建RGBA块
        const rgbaChunk = this._createRGBAChunk(palette);
        
        // 计算MAIN块大小
        const mainChunkSize = sizeChunk.length + xyziChunk.length + rgbaChunk.length;
        
        // 创建MAIN块头
        const mainChunkHeader = new Uint8Array([
            // "MAIN" ID
            0x4D, 0x41, 0x49, 0x4E,
            // 内容大小 (0因为MAIN没有内容，只有子块)
            0, 0, 0, 0,
            // 子块大小
        ]);
        
        // 添加子块大小
        const sizeBytes = this._writeInt32(mainChunkSize);
        const mainHeader = new Uint8Array(mainChunkHeader.length + sizeBytes.length);
        mainHeader.set(mainChunkHeader);
        mainHeader.set(sizeBytes, mainChunkHeader.length);
        
        // 合并所有块
        const result = new Uint8Array(mainHeader.length + mainChunkSize);
        result.set(mainHeader, 0);
        result.set(sizeChunk, mainHeader.length);
        result.set(xyziChunk, mainHeader.length + sizeChunk.length);
        result.set(rgbaChunk, mainHeader.length + sizeChunk.length + xyziChunk.length);
        
        return result;
    }
    
    private _createSizeChunk(size: Vector3): Uint8Array {
        // "SIZE" ID
        const sizeId = new Uint8Array([0x53, 0x49, 0x5A, 0x45]);
        // 内容大小
        const contentSize = new Uint8Array([12, 0, 0, 0]);
        // 子块大小
        const childSize = new Uint8Array([0, 0, 0, 0]);
        // SIZE数据: x, y, z
        const xBytes = this._writeInt32(Math.floor(size.x));
        const yBytes = this._writeInt32(Math.floor(size.y));
        const zBytes = this._writeInt32(Math.floor(size.z));
        
        // 合并数据
        const chunk = new Uint8Array(sizeId.length + contentSize.length + childSize.length + 
                                    xBytes.length + yBytes.length + zBytes.length);
        let offset = 0;
        chunk.set(sizeId, offset); offset += sizeId.length;
        chunk.set(contentSize, offset); offset += contentSize.length;
        chunk.set(childSize, offset); offset += childSize.length;
        chunk.set(xBytes, offset); offset += xBytes.length;
        chunk.set(yBytes, offset); offset += yBytes.length;
        chunk.set(zBytes, offset);
        
        return chunk;
    }
    
    private _createXYZIChunk(
        voxels: Voxel[], 
        minPos: Vector3, 
        colorMap: Map<string, number>
    ): Uint8Array {
        // 计算体素数据大小
        const voxelCount = voxels.length;
        const contentSize = 4 + voxelCount * 4; // 4字节数量 + 每个体素4字节(x,y,z,c)
        
        // "XYZI" ID
        const xyziId = new Uint8Array([0x58, 0x59, 0x5A, 0x49]);
        // 内容大小
        const contentSizeBytes = this._writeInt32(contentSize);
        // 子块大小
        const childSize = new Uint8Array([0, 0, 0, 0]);
        // 体素数量
        const voxelCountBytes = this._writeInt32(voxelCount);
        
        // 创建头部
        const headerSize = xyziId.length + contentSizeBytes.length + childSize.length + voxelCountBytes.length;
        const header = new Uint8Array(headerSize);
        let offset = 0;
        header.set(xyziId, offset); offset += xyziId.length;
        header.set(contentSizeBytes, offset); offset += contentSizeBytes.length;
        header.set(childSize, offset); offset += childSize.length;
        header.set(voxelCountBytes, offset);
        
        // 创建体素数据
        const voxelData = new Uint8Array(voxelCount * 4);
        
        voxels.forEach((voxel, index) => {
            // 计算相对坐标，确保为整数
            const x = Math.floor(voxel.position.x - minPos.x);
            const y = Math.floor(voxel.position.y - minPos.y);
            const z = Math.floor(voxel.position.z - minPos.z);
            
            // 确保坐标在有效范围内
            if (x < 0 || x > 255 || y < 0 || y > 255 || z < 0 || z > 255) {
                console.warn(`Voxel at (${x},${y},${z}) outside valid range, clamping`);
            }
            
            // 获取颜色索引
            const colorKey = this._colorToKey(voxel.colour);
            const colorIndex = colorMap.get(colorKey) || 1; // 默认使用第一个颜色
            
            // 设置体素数据 (x, y, z, colorIndex)
            voxelData[index * 4] = Math.max(0, Math.min(255, x));
            voxelData[index * 4 + 1] = Math.max(0, Math.min(255, y));
            voxelData[index * 4 + 2] = Math.max(0, Math.min(255, z));
            voxelData[index * 4 + 3] = colorIndex;
        });
        
        // 合并块头和体素数据
        const result = new Uint8Array(header.length + voxelData.length);
        result.set(header, 0);
        result.set(voxelData, header.length);
        
        return result;
    }
    
    private _createRGBAChunk(palette: Uint8Array): Uint8Array {
        // "RGBA" ID
        const rgbaId = new Uint8Array([0x52, 0x47, 0x42, 0x41]);
        // 内容大小 (256个颜色 * 4字节)
        const contentSize = new Uint8Array([0, 4, 0, 0]);
        // 子块大小
        const childSize = new Uint8Array([0, 0, 0, 0]);
        
        // 合并数据
        const chunk = new Uint8Array(rgbaId.length + contentSize.length + childSize.length + palette.length);
        let offset = 0;
        chunk.set(rgbaId, offset); offset += rgbaId.length;
        chunk.set(contentSize, offset); offset += contentSize.length;
        chunk.set(childSize, offset); offset += childSize.length;
        chunk.set(palette, offset);
        
        return chunk;
    }
    
    private _writeInt32(value: number): Uint8Array {
        return new Uint8Array([
            value & 0xFF,
            (value >> 8) & 0xFF,
            (value >> 16) & 0xFF,
            (value >> 24) & 0xFF
        ]);
    }
} 