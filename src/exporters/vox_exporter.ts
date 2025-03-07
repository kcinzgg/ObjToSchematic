import { BlockMesh } from '../block_mesh';
import { RGBA, RGBAColours, RGBAUtil } from '../colour';
import { ASSERT } from '../util/error_util';
import { LOG } from '../util/log_util';
import { Vector3 } from '../vector';
import { Voxel } from '../voxel_mesh';
import { IExporter, TStructureExport } from './base_exporter';

/**
 * 实现MagicaVoxel的.vox格式导出
 * 格式规范参考: https://github.com/ephtracy/voxel-model/blob/master/MagicaVoxel-file-format-vox.txt
 */
export class VoxExporter extends IExporter {
    // 定义光照方向，与着色器中相同
    private readonly _lightDirection = new Vector3(0.78, 0.98, 0.59).normalise();
    
    // 最小和最大光照值 - 进一步提高
    private readonly _minLightLevel = 0.9;   // 进一步提高基础亮度
    private readonly _maxLightLevel = 1.8;   // 增强最大亮度
    
    // 环境光水平 - 添加更强的环境光
    private readonly _ambientLight = 0.7;    // 70%的环境光
    
    // 颜色增强因子 - 更激进
    private readonly _colorBoost = 1.5;      // 更强的颜色提升
    
    // 模型尺寸和特征
    private _modelBounds: { min: Vector3, max: Vector3, center: Vector3, height: number } | null = null;
    
    // 材质定义
    private readonly _materialTypes = {
        STONE: 'stone',
        WOOD: 'wood',
        METAL: 'metal',
        WINDOW: 'window',
        ROOF: 'roof',
        GROUND: 'ground',
        UNKNOWN: 'unknown'
    };
    
    // 材质增强参数
    private readonly _materialEnhancement = {
        stone: { lightBoost: 1.5, saturation: 1.1, brightnessShift: 0.2 },
        wood: { lightBoost: 1.7, saturation: 1.5, brightnessShift: 0.25 },
        metal: { lightBoost: 2.0, saturation: 0.9, brightnessShift: 0.3 },
        window: { lightBoost: 2.5, saturation: 1.2, brightnessShift: 0.4 },
        roof: { lightBoost: 1.6, saturation: 1.4, brightnessShift: 0.15 },
        ground: { lightBoost: 1.4, saturation: 1.3, brightnessShift: 0.1 },
        unknown: { lightBoost: 1.5, saturation: 1.2, brightnessShift: 0.2 }
    };
    
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
        LOG(`处理${voxels.length}个体素用于VOX导出`);
        
        // 获取模型的边界
        const bounds = voxelMesh.getBounds();
        const minPos = bounds.min;
        const size = Vector3.sub(bounds.max, bounds.min).add(1);
        
        // 计算并存储模型的一些关键特征，用于后续材质判定
        this._analyzeModelFeatures(bounds, voxels);
        
        // 确保模型尺寸不超过VOX格式的最大限制(256x256x256)
        ASSERT(size.x <= 256 && size.y <= 256 && size.z <= 256, 
            `Model size exceeds VOX format limits: ${size.x}x${size.y}x${size.z}`);
        
        // 预处理：计算每个体素的估计法线和应用光照
        const voxelsWithLighting = this._applyLighting(voxels, voxelMesh);
        
        // 提取并处理颜色
        const { colorMap, palette } = this._processColors(voxelsWithLighting);
        
        // 创建文件内容
        // 1. 文件头
        const header = new Uint8Array([
            // "VOX " 魔数
            0x56, 0x4F, 0x58, 0x20,
            // 版本号 (150)
            150, 0, 0, 0
        ]);
        
        // 2. MAIN块
        const mainChunk = this._createMainChunk(voxelsWithLighting, minPos, size, colorMap, palette);
        
        // 合并所有数据
        const result = new Uint8Array(header.length + mainChunk.length);
        result.set(header, 0);
        result.set(mainChunk, header.length);
        
        return result;
    }
    
    /**
     * 分析模型特征用于材质识别
     */
    private _analyzeModelFeatures(bounds: { min: Vector3, max: Vector3 }, voxels: Voxel[]) {
        const center = new Vector3(
            (bounds.min.x + bounds.max.x) / 2,
            (bounds.min.y + bounds.max.y) / 2,
            (bounds.min.z + bounds.max.z) / 2
        );
        
        const height = bounds.max.y - bounds.min.y;
        
        this._modelBounds = {
            min: bounds.min,
            max: bounds.max,
            center: center,
            height: height
        };
        
        LOG(`模型分析: 中心点(${center.x.toFixed(1)}, ${center.y.toFixed(1)}, ${center.z.toFixed(1)}), 高度: ${height.toFixed(1)}`);
    }
    
    /**
     * 应用光照效果到体素颜色上，并识别材质
     */
    private _applyLighting(voxels: Voxel[], voxelMesh: any): Array<Voxel & { litColor: RGBA, material: string }> {
        // 创建位置到索引的映射以便快速查找邻居
        const positionMap = new Map<number, number>();
        voxels.forEach((voxel, index) => {
            positionMap.set(voxel.position.hash(), index);
        });
        
        // 应用光照处理
        return voxels.map(voxel => {
            // 识别体素材质
            const material = this._identifyMaterial(voxel);
            
            // 计算估计法线
            const normal = this._estimateNormal(voxel, positionMap, voxels);
            
            // 计算光照系数
            const lightLevel = this._calculateLighting(normal);
            
            // 根据材质应用特定的光照和颜色增强
            const litColor = this._enhanceColorByMaterial(voxel.colour, lightLevel, material);
            
            // 返回带有烘焙光照和材质的体素
            return {
                ...voxel,
                litColor,
                material
            };
        });
    }
    
    /**
     * 识别体素的材质类型
     */
    private _identifyMaterial(voxel: Voxel): string {
        if (!this._modelBounds) return this._materialTypes.UNKNOWN;
        
        const color = voxel.colour;
        const pos = voxel.position;
        
        // 计算位置相关特征
        const heightPercent = (pos.y - this._modelBounds.min.y) / this._modelBounds.height;
        const distFromCenter = Math.sqrt(
            Math.pow(pos.x - this._modelBounds.center.x, 2) +
            Math.pow(pos.z - this._modelBounds.center.z, 2)
        );
        
        // 计算颜色特征
        const brightness = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
        const isGrayscale = Math.abs(color.r - color.g) < 0.1 && Math.abs(color.r - color.b) < 0.1;
        const redDominance = color.r > color.g * 1.2 && color.r > color.b * 1.2;
        const blueDominance = color.b > color.r * 1.2 && color.b > color.g * 1.2;
        
        // 基于位置和颜色特征识别材质
        
        // 检测地面/底座 (底部20%的蓝色系区域)
        if (heightPercent < 0.2 && (blueDominance || brightness > 0.7)) {
            return this._materialTypes.GROUND;
        }
        
        // 检测窗户 (中部区域的高亮度或高对比度部分)
        if (heightPercent > 0.3 && heightPercent < 0.8 && brightness > 0.6) {
            return this._materialTypes.WINDOW;
        }
        
        // 检测屋顶 (顶部的褐色系区域)
        if (heightPercent > 0.75 && redDominance) {
            return this._materialTypes.ROOF;
        }
        
        // 检测金属部分 (高亮度，灰色调)
        if (brightness > 0.7 && isGrayscale) {
            return this._materialTypes.METAL;
        }
        
        // 检测木质部分 (中亮度，偏褐色)
        if (brightness > 0.3 && brightness < 0.7 && redDominance) {
            return this._materialTypes.WOOD;
        }
        
        // 默认为石头 (灰色系，大部分建筑结构)
        if (isGrayscale || (brightness < 0.5 && !redDominance && !blueDominance)) {
            return this._materialTypes.STONE;
        }
        
        return this._materialTypes.UNKNOWN;
    }
    
    /**
     * 根据材质类型增强颜色
     */
    private _enhanceColorByMaterial(color: RGBA, lightLevel: number, material: string): RGBA {
        // 安全地访问材质参数
        const params = this._materialEnhancement[material as keyof typeof this._materialEnhancement] 
            || this._materialEnhancement.unknown;
        const litColor = RGBAUtil.copy(color);
        
        // 结合环境光和方向光
        const finalLightLevel = this._ambientLight + 
            (lightLevel * (1.0 - this._ambientLight) * params.lightBoost);
        
        // 转换为HSL以便调整饱和度和亮度
        const hsl = this._rgbToHsl(litColor.r, litColor.g, litColor.b);
        
        // 增强饱和度
        hsl.s = Math.min(1.0, hsl.s * params.saturation);
        
        // 增强亮度
        hsl.l = Math.min(1.0, hsl.l * finalLightLevel + params.brightnessShift);
        
        // 转回RGB
        const rgb = this._hslToRgb(hsl.h, hsl.s, hsl.l);
        
        litColor.r = rgb.r;
        litColor.g = rgb.g;
        litColor.b = rgb.b;
        
        return litColor;
    }
    
    /**
     * RGB转HSL
     */
    private _rgbToHsl(r: number, g: number, b: number): { h: number, s: number, l: number } {
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h = 0, s = 0;
        const l = (max + min) / 2;
        
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            
            h /= 6;
        }
        
        return { h, s, l };
    }
    
    /**
     * HSL转RGB
     */
    private _hslToRgb(h: number, s: number, l: number): { r: number, g: number, b: number } {
        let r, g, b;
        
        if (s === 0) {
            r = g = b = l; // 灰色
        } else {
            const hue2rgb = (p: number, q: number, t: number) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1/6) return p + (q - p) * 6 * t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
            };
            
            const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
            const p = 2 * l - q;
            
            r = hue2rgb(p, q, h + 1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h - 1/3);
        }
        
        return { r, g, b };
    }
    
    /**
     * 估计体素的法线方向
     * 通过检查周围6个方向是否有体素来确定
     */
    private _estimateNormal(voxel: Voxel, positionMap: Map<number, number>, allVoxels: Voxel[]): Vector3 {
        // 检查6个主要方向
        const directions = [
            new Vector3(1, 0, 0),   // +X
            new Vector3(-1, 0, 0),  // -X
            new Vector3(0, 1, 0),   // +Y
            new Vector3(0, -1, 0),  // -Y
            new Vector3(0, 0, 1),   // +Z
            new Vector3(0, 0, -1),  // -Z
        ];
        
        // 累计法线贡献
        const normal = new Vector3(0, 0, 0);
        
        // 检查每个方向
        directions.forEach(dir => {
            const neighborPos = Vector3.add(voxel.position, dir);
            const neighborHash = neighborPos.hash();
            
            // 如果该方向没有体素，则认为法线朝向该方向
            if (!positionMap.has(neighborHash)) {
                normal.add(dir);
            }
        });
        
        // 如果所有方向都有体素或都没有，使用默认向上的法线
        if (normal.magnitude() < 0.001) {
            normal.y = 1;  // 默认向上
        } else {
            normal.normalise();
        }
        
        // 倾向于向光源方向偏移法线，提高整体亮度
        const lightBias = 0.4; // 40%的光源偏移
        normal.x = normal.x * (1 - lightBias) + this._lightDirection.x * lightBias;
        normal.y = normal.y * (1 - lightBias) + this._lightDirection.y * lightBias;
        normal.z = normal.z * (1 - lightBias) + this._lightDirection.z * lightBias;
        normal.normalise();
        
        return normal;
    }
    
    /**
     * 计算光照系数
     */
    private _calculateLighting(normal: Vector3): number {
        // 基于法线和光照方向计算光照系数（与着色器逻辑类似）
        const dotProduct = Math.abs(Vector3.dot(normal, this._lightDirection));
        
        // 确保基础光照水平，避免完全黑暗
        const lightLevel = this._minLightLevel + 
            (this._maxLightLevel - this._minLightLevel) * dotProduct;
            
        return lightLevel;
    }
    
    /**
     * 处理颜色数据，使用带有光照效果的颜色
     */
    private _processColors(voxels: Array<Voxel & { litColor: RGBA, material: string }>): { colorMap: Map<string, number>, palette: Uint8Array } {
        // 直接使用应用了光照的体素颜色
        const uniqueColors = new Map<string, { color: RGBA, count: number }>();
        
        // 统计各种材质数量
        const materialCount: Record<string, number> = {};
        
        // 收集所有唯一颜色及其使用次数
        voxels.forEach(voxel => {
            // 统计材质
            materialCount[voxel.material] = (materialCount[voxel.material] || 0) + 1;
            
            // 使用带光照的颜色
            const key = this._colorToKey(voxel.litColor);
            
            if (uniqueColors.has(key)) {
                uniqueColors.get(key)!.count++;
            } else {
                uniqueColors.set(key, { 
                    color: RGBAUtil.copy(voxel.litColor), 
                    count: 1 
                });
            }
        });
        
        // 打印材质统计
        LOG('材质统计:');
        Object.keys(materialCount).forEach(mat => {
            LOG(`  ${mat}: ${materialCount[mat]}体素`);
        });
        
        // 添加一些基础颜色，确保调色板不为空
        this._addBasicColors(uniqueColors);
        
        // 转换为数组并按使用频率排序
        const colorEntries = Array.from(uniqueColors.entries())
            .map(([key, entry]) => ({ key, color: entry.color, count: entry.count }))
            .sort((a, b) => b.count - a.count); // 使用频率高的颜色优先
        
        // 限制颜色数量为255（VOX格式限制）
        const limitedColors = colorEntries.slice(0, 255);
        
        // 创建最终的颜色映射和调色板
        const colorMap = new Map<string, number>();
        const palette = new Uint8Array(256 * 4);
        
        // 设置默认色(索引0为默认透明色)
        palette[0] = 0; palette[1] = 0; palette[2] = 0; palette[3] = 0;
        
        // 填充调色板
        limitedColors.forEach((entry, index) => {
            const i = index + 1; // 从1开始，0是透明色
            colorMap.set(entry.key, i);
            
            // MagicaVoxel使用BGRA格式存储颜色
            palette[i * 4] = Math.round(entry.color.b * 255);     // B
            palette[i * 4 + 1] = Math.round(entry.color.g * 255); // G
            palette[i * 4 + 2] = Math.round(entry.color.r * 255); // R
            palette[i * 4 + 3] = Math.round(entry.color.a * 255); // A
        });
        
        LOG(`为VOX格式处理了${limitedColors.length}种颜色`);
        return { colorMap, palette };
    }
    
    /**
     * 添加基础颜色到颜色集合
     */
    private _addBasicColors(colorMap: Map<string, { color: RGBA, count: number }>) {
        // 基础颜色集合
        const basicColors = [
            RGBAColours.RED,
            RGBAColours.GREEN, 
            RGBAColours.BLUE,
            RGBAColours.YELLOW,
            RGBAColours.CYAN,
            RGBAColours.MAGENTA,
            RGBAColours.WHITE,
            RGBAColours.BLACK,
            { r: 0.5, g: 0.5, b: 0.5, a: 1.0 } // 灰色
        ];
        
        // 确保基础颜色存在于调色板中
        basicColors.forEach(color => {
            const key = this._colorToKey(color);
            if (!colorMap.has(key)) {
                colorMap.set(key, { color: RGBAUtil.copy(color), count: 0 });
            }
        });
    }
    
    private _colorToKey(color: RGBA): string {
        return `${Math.round(color.r*255)},${Math.round(color.g*255)},${Math.round(color.b*255)},${Math.round(color.a*255)}`;
    }
    
    private _createMainChunk(
        voxels: Array<Voxel & { litColor: RGBA, material: string }>, 
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
        const yBytes = this._writeInt32(Math.floor(size.z)); // 注意：交换了Y和Z轴
        const zBytes = this._writeInt32(Math.floor(size.y));
        
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
        voxels: Array<Voxel & { litColor: RGBA, material: string }>, 
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
        
        let validVoxelCount = 0;
        voxels.forEach((voxel, index) => {
            // 计算相对坐标，确保为整数
            // 注意：MagicaVoxel使用右手坐标系，我们需要调整坐标映射
            const x = Math.floor(voxel.position.x - minPos.x);
            const y = Math.floor(voxel.position.z - minPos.z); // Z轴映射到Y轴
            const z = Math.floor(voxel.position.y - minPos.y); // Y轴映射到Z轴
            
            // 确保坐标在有效范围内
            if (x < 0 || x > 255 || y < 0 || y > 255 || z < 0 || z > 255) {
                LOG(`Voxel at (${x},${y},${z}) outside valid range, skipping`);
                return;
            }
            
            // 使用带有光照的颜色
            const colorKey = this._colorToKey(voxel.litColor);
            const colorIndex = colorMap.get(colorKey) || 1; // 默认使用第一个颜色
            
            // 设置体素数据 (x, y, z, colorIndex)
            const voxelIndex = validVoxelCount * 4;
            voxelData[voxelIndex] = x;
            voxelData[voxelIndex + 1] = y;
            voxelData[voxelIndex + 2] = z;
            voxelData[voxelIndex + 3] = colorIndex;
            
            validVoxelCount++;
        });
        
        // 如果有些体素被跳过，调整最终数据大小
        let finalVoxelData = voxelData;
        if (validVoxelCount < voxelCount) {
            finalVoxelData = voxelData.slice(0, validVoxelCount * 4);
            // 需要调整内容大小和体素数量
            const newContentSize = 4 + validVoxelCount * 4;
            contentSizeBytes.set(this._writeInt32(newContentSize));
            voxelCountBytes.set(this._writeInt32(validVoxelCount));
        }
        
        // 合并块头和体素数据
        const result = new Uint8Array(header.length + finalVoxelData.length);
        result.set(header, 0);
        result.set(finalVoxelData, header.length);
        
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