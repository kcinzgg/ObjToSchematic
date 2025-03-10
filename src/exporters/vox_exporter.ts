import { BlockMesh } from '../block_mesh';
import { Vector3 } from '../vector';
import { Voxel } from '../voxel_mesh';
import { RGBA } from '../colour';
import { IExporter, TStructureExport } from './base_exporter';
import { ASSERT, AppError } from '../util/error_util';
import { LOC } from '../localiser';
import { StatusHandler } from '../status';
import { ProgressManager } from '../progress';
import { Buffer } from 'buffer';
// 移除fs和path导入
// 移除Jimp导入

// 导入颜色量化器
import { ColorQuantizer } from './color_quantizer';

/**
 * MagicaVoxel (.vox) 格式导出器
 * 简化版本，直接从体素中提取颜色，不处理材质和光照
 */
export class VoxExporter extends IExporter {
    /** 最大安全体素数量 */
    public static readonly MAX_SAFE_VOXELS = 400000;
    
    /** VOX格式支持的最大尺寸 */
    public static readonly MAX_SIZE = 256;
    
    /** VOX格式支持的最大颜色数量 */
    public static readonly MAX_COLORS = 255; // 256-1，因为0是透明色
    
    /** 单批处理的体素数量 */
    private static readonly BATCH_SIZE = 200;
    
    /** 导出是否正在进行中 */
    private _isExporting: boolean = false;
    
    /** 导出结果 */
    private _exportResult: TStructureExport | null = null;
    
    /** 导出错误 */
    private _exportError: Error | null = null;
    
    /** 导出完成的回调函数 */
    private _exportCallback: ((result: TStructureExport) => void) | null = null;
    
    /** 进度管理任务ID */
    private _taskId: any = null;
    
    // 修改预设调色板相关属性
    private static _presetPalette: {r: number, g: number, b: number, a: number}[] | null = null;
    private static _usePresetPalette: boolean = true; // 默认使用预设调色板

    /**
     * 设置是否使用预设调色板
     */
    public static setUsePresetPalette(use: boolean): void {
        VoxExporter._usePresetPalette = use;
    }

    /**
     * 获取是否使用预设调色板
     */
    public static getUsePresetPalette(): boolean {
        return VoxExporter._usePresetPalette;
    }

    /**
     * 初始化默认MagicaVoxel调色板
     * 使用MagicaVoxel的官方调色板
     */
    public static initDefaultPalette(): void {
        // MagicaVoxel官方调色板 (从Python代码转换)
        // 格式从0xAARRGGBB转换为{r,g,b,a}对象
        const magicaVoxelPalette = [
            0x00000000, 0xffffffff, 0xffccffff, 0xff99ffff, 0xff66ffff, 0xff33ffff, 0xff00ffff, 0xffffccff,
            0xffccccff, 0xff99ccff, 0xff66ccff, 0xff33ccff, 0xff00ccff, 0xffff99ff, 0xffcc99ff, 0xff9999ff,
            0xff6699ff, 0xff3399ff, 0xff0099ff, 0xffff66ff, 0xffcc66ff, 0xff9966ff, 0xff6666ff, 0xff3366ff,
            0xff0066ff, 0xffff33ff, 0xffcc33ff, 0xff9933ff, 0xff6633ff, 0xff3333ff, 0xff0033ff, 0xffff00ff,
            0xffcc00ff, 0xff9900ff, 0xff6600ff, 0xff3300ff, 0xff0000ff, 0xffffffcc, 0xffccffcc, 0xff99ffcc,
            0xff66ffcc, 0xff33ffcc, 0xff00ffcc, 0xffffcccc, 0xffcccccc, 0xff99cccc, 0xff66cccc, 0xff33cccc,
            0xff00cccc, 0xffff99cc, 0xffcc99cc, 0xff9999cc, 0xff6699cc, 0xff3399cc, 0xff0099cc, 0xffff66cc,
            0xffcc66cc, 0xff9966cc, 0xff6666cc, 0xff3366cc, 0xff0066cc, 0xffff33cc, 0xffcc33cc, 0xff9933cc,
            0xff6633cc, 0xff3333cc, 0xff0033cc, 0xffff00cc, 0xffcc00cc, 0xff9900cc, 0xff6600cc, 0xff3300cc,
            0xff0000cc, 0xffffff99, 0xffccff99, 0xff99ff99, 0xff66ff99, 0xff33ff99, 0xff00ff99, 0xffffcc99,
            0xffcccc99, 0xff99cc99, 0xff66cc99, 0xff33cc99, 0xff00cc99, 0xffff9999, 0xffcc9999, 0xff999999,
            0xff669999, 0xff339999, 0xff009999, 0xffff6699, 0xffcc6699, 0xff996699, 0xff666699, 0xff336699,
            0xff006699, 0xffff3399, 0xffcc3399, 0xff993399, 0xff663399, 0xff333399, 0xff003399, 0xffff0099,
            0xffcc0099, 0xff990099, 0xff660099, 0xff330099, 0xff000099, 0xffffff66, 0xffccff66, 0xff99ff66,
            0xff66ff66, 0xff33ff66, 0xff00ff66, 0xffffcc66, 0xffcccc66, 0xff99cc66, 0xff66cc66, 0xff33cc66,
            0xff00cc66, 0xffff9966, 0xffcc9966, 0xff999966, 0xff669966, 0xff339966, 0xff009966, 0xffff6666,
            0xffcc6666, 0xff996666, 0xff666666, 0xff336666, 0xff006666, 0xffff3366, 0xffcc3366, 0xff993366,
            0xff663366, 0xff333366, 0xff003366, 0xffff0066, 0xffcc0066, 0xff990066, 0xff660066, 0xff330066,
            0xff000066, 0xffffff33, 0xffccff33, 0xff99ff33, 0xff66ff33, 0xff33ff33, 0xff00ff33, 0xffffcc33,
            0xffcccc33, 0xff99cc33, 0xff66cc33, 0xff33cc33, 0xff00cc33, 0xffff9933, 0xffcc9933, 0xff999933,
            0xff669933, 0xff339933, 0xff009933, 0xffff6633, 0xffcc6633, 0xff996633, 0xff666633, 0xff336633,
            0xff006633, 0xffff3333, 0xffcc3333, 0xff993333, 0xff663333, 0xff333333, 0xff003333, 0xffff0033,
            0xffcc0033, 0xff990033, 0xff660033, 0xff330033, 0xff000033, 0xffffff00, 0xffccff00, 0xff99ff00,
            0xff66ff00, 0xff33ff00, 0xff00ff00, 0xffffcc00, 0xffcccc00, 0xff99cc00, 0xff66cc00, 0xff33cc00,
            0xff00cc00, 0xffff9900, 0xffcc9900, 0xff999900, 0xff669900, 0xff339900, 0xff009900, 0xffff6600,
            0xffcc6600, 0xff996600, 0xff666600, 0xff336600, 0xff006600, 0xffff3300, 0xffcc3300, 0xff993300,
            0xff663300, 0xff333300, 0xff003300, 0xffff0000, 0xffcc0000, 0xff990000, 0xff660000, 0xff330000,
            0xff0000ee, 0xff0000dd, 0xff0000bb, 0xff0000aa, 0xff000088, 0xff000077, 0xff000055, 0xff000044,
            0xff000022, 0xff000011, 0xff00ee00, 0xff00dd00, 0xff00bb00, 0xff00aa00, 0xff008800, 0xff007700,
            0xff005500, 0xff004400, 0xff002200, 0xff001100, 0xffee0000, 0xffdd0000, 0xffbb0000, 0xffaa0000,
            0xff880000, 0xff770000, 0xff550000, 0xff440000, 0xff220000, 0xff110000, 0xffeeeeee, 0xffdddddd,
            0xffbbbbbb, 0xffaaaaaa, 0xff888888, 0xff777777, 0xff555555, 0xff444444, 0xff222222, 0xff111111
        ];
        
        // 转换为我们的格式
        const palette: {r: number, g: number, b: number, a: number}[] = [];
        
        for (const color of magicaVoxelPalette) {
            // 从0xAARRGGBB格式提取RGBA值
            const a = (color >> 24) & 0xFF;
            const r = (color >> 16) & 0xFF;
            const g = (color >> 8) & 0xFF;
            const b = color & 0xFF;
            
            palette.push({r, g, b, a});
        }
        
        console.log(`初始化了${palette.length}种颜色的MagicaVoxel官方调色板`);
        VoxExporter._presetPalette = palette;
    }

    public override getFormatFilter() {
        return {
            name: 'MagicaVoxel',
            extension: 'vox',
        };
    }
    
    public override export(blockMesh: BlockMesh): TStructureExport {
        // 如果已经在导出中，抛出错误
        if (this._isExporting) {
            throw new Error('An export is already in progress. Please wait for it to complete.');
        }
        
        // 标记导出开始
        this._isExporting = true;
        this._exportResult = null;
        this._exportError = null;
        
        // 创建一个进度任务
        this._taskId = ProgressManager.Get.start('Exporting');
        if (this._taskId) {
            ProgressManager.Get.progress(this._taskId, 0.01);
        }
        
        // 显示状态消息
        StatusHandler.info(LOC('export.exporting_structure'));
        
        try {
            // 获取所有方块
            const blocks = blockMesh.getBlocks();
            console.log('Blocks:', blocks.length);
            
            // 安全检查 - 如果方块数量太多，可能会导致浏览器卡死
            if (blocks.length > VoxExporter.MAX_SAFE_VOXELS) {
                if (this._taskId) {
                    ProgressManager.Get.end(this._taskId);
                }
                this._isExporting = false;
                throw new AppError(LOC('something_went_wrong'));
            }
            
            // 同步处理体素数据
            const { buffer, extension } = this._processVoxDataSync(blockMesh);
            
            // 更新进度
            if (this._taskId) {
                ProgressManager.Get.progress(this._taskId, 1.0);
                ProgressManager.Get.end(this._taskId);
                this._taskId = null;
            }
            
            // 标记导出完成
            this._isExporting = false;
            
            // 返回结果
            return {
                type: 'single',
                extension: extension,
                content: buffer
            };
        } catch (error) {
            // 出现错误，结束导出状态
            if (this._taskId) {
                ProgressManager.Get.end(this._taskId);
                this._taskId = null;
            }
            this._isExporting = false;
            console.error('VOX导出错误:', error);
            if (error instanceof AppError) {
                throw error;
            } else {
                throw new AppError(LOC('something_went_wrong'));
            }
        }
    }
    
    /**
     * 同步处理体素数据并创建VOX文件
     */
    private _processVoxDataSync(blockMesh: BlockMesh): { buffer: Buffer, extension: string } {
        // 获取体素网格
        const voxelMesh = blockMesh.getVoxelMesh();
        ASSERT(voxelMesh !== undefined, "Voxel mesh is undefined");
        
        // 从体素网格中获取所有体素
        const voxels = voxelMesh.getVoxels();
        console.log(`处理${voxels.length}个体素用于VOX导出`);
        
        // 获取模型的边界
        const bounds = voxelMesh.getBounds();
        const minPos = bounds.min;
        const size = Vector3.sub(bounds.max, bounds.min).add(new Vector3(1, 1, 1));
        
        // 确保模型尺寸不超过VOX格式的最大限制(256x256x256)
        if (size.x > VoxExporter.MAX_SIZE || size.y > VoxExporter.MAX_SIZE || size.z > VoxExporter.MAX_SIZE) {
            throw new AppError(LOC('something_went_wrong'));
        }
        
        // 收集所有颜色并转换为RGBA整数值
        const allColors: {r: number, g: number, b: number, a: number}[] = [];
        voxels.forEach(voxel => {
            allColors.push({
                r: Math.round(voxel.colour.r * 255),
                g: Math.round(voxel.colour.g * 255),
                b: Math.round(voxel.colour.b * 255),
                a: Math.round(voxel.colour.a * 255)
            });
        });
        
        // 智能处理调色板 - 优先确保重要/常见颜色
        const { colorMap, palette } = this._createOptimizedPalette(allColors);
        
        // 处理体素，分配颜色索引
        const processedVoxels: Array<{x: number, y: number, z: number, colorIndex: number}> = [];
        
        for (const voxel of voxels) {
            // 计算相对位置
            const x = size.x -1 - Math.floor(voxel.position.x - minPos.x);
            const y = Math.floor(voxel.position.y - minPos.y);
            const z = Math.floor(voxel.position.z - minPos.z);
            
            // 安全检查
            if (x < 0 || y < 0 || z < 0 || x >= VoxExporter.MAX_SIZE || y >= VoxExporter.MAX_SIZE || z >= VoxExporter.MAX_SIZE) {
                continue; // 跳过超出范围的体素
            }
            
            // 转换颜色
            const color = {
                r: Math.round(voxel.colour.r * 255),
                g: Math.round(voxel.colour.g * 255),
                b: Math.round(voxel.colour.b * 255),
                a: Math.round(voxel.colour.a * 255)
            };
            
            // 使用调色板映射获取颜色索引
            const colorKey = `${color.r},${color.g},${color.b},${color.a}`;
            let colorIndex: number;
            
            if (colorMap.has(colorKey)) {
                colorIndex = colorMap.get(colorKey)!;
            } else {
                // 查找最接近的颜色
                colorIndex = this._findClosestColorIndex(color, palette);
            }
            
            // 添加到处理后的体素列表
            processedVoxels.push({ x, y, z, colorIndex });
        }
        
        // 创建VOX文件头
        const headerBuffer = this._createVoxHeader();
        
        // 创建主块
        const mainBuffer = this._createMainChunk(size.x, size.y, size.z, processedVoxels, palette);
        
        // 合并所有部分
        const fileBuffer = Buffer.concat([headerBuffer, mainBuffer]);
        
        return {
            buffer: fileBuffer,
            extension: '.vox'
        };
    }
    
    /**
     * 创建优化的调色板
     */
    private _createOptimizedPalette(colors: {r: number, g: number, b: number, a: number}[]): { 
        colorMap: Map<string, number>, 
        palette: {r: number, g: number, b: number, a: number}[] 
    } {
        // 如果启用了预设调色板并且已加载，则使用预设调色板
        if (VoxExporter._usePresetPalette && VoxExporter._presetPalette !== null) {
            console.log('使用预设调色板');
            
            // 创建颜色映射
            const colorMap = new Map<string, number>();
            VoxExporter._presetPalette.forEach((color, index) => {
                const key = `${color.r},${color.g},${color.b},${color.a}`;
                colorMap.set(key, index);
            });
            
            return { colorMap, palette: [...VoxExporter._presetPalette] };
        }
        
        // 使用MMCQ算法生成优化的调色板
        console.log(`使用MMCQ算法优化调色板，从${colors.length}种颜色中提取`);
        
        // 定义一些关键颜色（透明色、白色、黑色等）
        const keyColors: {r: number, g: number, b: number, a: number}[] = [
            {r: 0, g: 0, b: 0, a: 0},         // 透明色
            {r: 255, g: 255, b: 255, a: 255}, // 白色
            {r: 0, g: 0, b: 0, a: 255},       // 黑色
            {r: 128, g: 128, b: 128, a: 255}, // 灰色
            
            // 基本RGB颜色
            {r: 255, g: 0, b: 0, a: 255},     // 红色
            {r: 0, g: 255, b: 0, a: 255},     // 绿色
            {r: 0, g: 0, b: 255, a: 255},     // 蓝色
            
            // 塔楼屋顶蓝色系列
            {r: 30, g: 110, b: 190, a: 255},  // 蓝色屋顶
            {r: 40, g: 130, b: 210, a: 255},  // 亮蓝色屋顶
            {r: 70, g: 160, b: 230, a: 255},  // 天蓝色屋顶
            {r: 20, g: 80, b: 170, a: 255},   // 深蓝色屋顶
        ];
        
        // 使用MMCQ算法生成调色板，确保包含关键颜色
        const optimizedPalette = ColorQuantizer.quantizeWithKeyColors(
            colors,
            VoxExporter.MAX_COLORS,
            keyColors
        );
        
        // 创建颜色映射
        const colorMap = new Map<string, number>();
        optimizedPalette.forEach((color, index) => {
            const key = `${color.r},${color.g},${color.b},${color.a}`;
            colorMap.set(key, index);
        });
        
        console.log(`创建了${optimizedPalette.length}种颜色的优化调色板`);
        return { colorMap, palette: optimizedPalette };
    }
    
    /**
     * 查找最接近的颜色索引
     */
    private _findClosestColorIndex(targetColor: {r: number, g: number, b: number, a: number}, palette: {r: number, g: number, b: number, a: number}[]): number {
        // 使用ColorQuantizer的颜色匹配算法
        return ColorQuantizer.findClosestColorIndex(targetColor, palette);
    }
    
    /**
     * 创建VOX文件头
     */
    private _createVoxHeader(): Buffer {
        const buffer = Buffer.alloc(8);
        
        // 写入"VOX "标识
        buffer.write('VOX ', 0);
        
        // 写入版本号（150）
        buffer.writeInt32LE(150, 4);
        
        return buffer;
    }
    
    /**
     * 创建主块（MAIN）
     */
    private _createMainChunk(sizeX: number, sizeY: number, sizeZ: number, voxels: Array<{x: number, y: number, z: number, colorIndex: number}>, palette: {r: number, g: number, b: number, a: number}[]): Buffer {
        // 创建SIZE块
        const sizeChunk = this._createSizeChunk(sizeX, sizeY, sizeZ);
        
        // 创建XYZI块
        const xyziChunk = this._createXYZIChunk(voxels);
        
        // 创建RGBA块
        const rgbaChunk = this._createRGBAChunk(palette);
        
        // 计算子块总大小
        const childrenSize = sizeChunk.length + xyziChunk.length + rgbaChunk.length;
        
        // 创建MAIN块头
        const mainHeader = Buffer.alloc(12);
        mainHeader.write('MAIN', 0);
        mainHeader.writeInt32LE(0, 4);  // 内容大小为0
        mainHeader.writeInt32LE(childrenSize, 8);  // 子块大小
        
        // 合并所有块
        return Buffer.concat([
            mainHeader,
            sizeChunk,
            xyziChunk,
            rgbaChunk
        ]);
    }
    
    /**
     * 创建SIZE块
     */
    private _createSizeChunk(sizeX: number, sizeY: number, sizeZ: number): Buffer {
        const buffer = Buffer.alloc(24);
        
        // 块头部
        buffer.write('SIZE', 0);
        buffer.writeInt32LE(12, 4);  // 内容大小
        buffer.writeInt32LE(0, 8);   // 子块大小
        
        // 块内容
        buffer.writeInt32LE(sizeX, 12);
        buffer.writeInt32LE(sizeZ, 16);  // 注意：MagicaVoxel使用Y-up坐标系，但我们使用Z-up，所以交换Y和Z
        buffer.writeInt32LE(sizeY, 20);
        
        return buffer;
    }
    
    /**
     * 创建XYZI块
     */
    private _createXYZIChunk(voxels: Array<{x: number, y: number, z: number, colorIndex: number}>): Buffer {
        const buffer = Buffer.alloc(16 + voxels.length * 4);
        
        // 块头部
        buffer.write('XYZI', 0);
        buffer.writeInt32LE(4 + voxels.length * 4, 4);  // 内容大小 (4字节numVoxels + 每个体素4字节)
        buffer.writeInt32LE(0, 8);  // 子块大小
        
        // 体素数量
        buffer.writeInt32LE(voxels.length, 12);
        
        // 体素数据
        let offset = 16;
        for (const voxel of voxels) {
            buffer.writeUInt8(voxel.x, offset);
            buffer.writeUInt8(voxel.z, offset + 1);  // 交换Y和Z坐标
            buffer.writeUInt8(voxel.y, offset + 2);
            buffer.writeUInt8(voxel.colorIndex, offset + 3);
            offset += 4;
        }
        
        return buffer;
    }
    
    /**
     * 创建RGBA块
     */
    private _createRGBAChunk(palette: {r: number, g: number, b: number, a: number}[]): Buffer {
        const buffer = Buffer.alloc(1024 + 12);  // 256个RGBA值 + 头部
        
        // 块头部
        buffer.write('RGBA', 0);
        buffer.writeInt32LE(1024, 4);  // 内容大小
        buffer.writeInt32LE(0, 8);     // 子块大小
        
        // 初始化所有颜色为0
        for (let i = 0; i < 256; i++) {
            const offset = 12 + i * 4;
            buffer.writeUInt8(0, offset);     // R
            buffer.writeUInt8(0, offset + 1); // G
            buffer.writeUInt8(0, offset + 2); // B
            buffer.writeUInt8(0, offset + 3); // A
        }
        
        // 填充调色板
        palette.forEach((color, index) => {
            const offset = 12 + index * 4;
            buffer.writeUInt8(color.r, offset);
            buffer.writeUInt8(color.g, offset + 1);
            buffer.writeUInt8(color.b, offset + 2);
            buffer.writeUInt8(color.a, offset + 3);
        });
        
        return buffer;
    }
}

// 在模块加载时初始化默认调色板
VoxExporter.initDefaultPalette(); 