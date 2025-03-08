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
            const x = Math.floor(voxel.position.x - minPos.x);
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
        
        // 否则使用现有的动态调色板生成算法
        // 大幅扩展的预定义基础调色板，特别关注常见建筑材质颜色和MagicaVoxel常用颜色
        const basePalette: {r: number, g: number, b: number, a: number}[] = [
            {r: 0, g: 0, b: 0, a: 0},         // 索引0: 透明
            {r: 255, g: 255, b: 255, a: 255}, // 索引1: 白色
            {r: 0, g: 0, b: 0, a: 255},       // 索引2: 黑色
            
            // 灰度系列 - 建筑中常用
            {r: 32, g: 32, b: 32, a: 255},    // 深黑灰
            {r: 64, g: 64, b: 64, a: 255},    // 暗灰
            {r: 96, g: 96, b: 96, a: 255},    // 中深灰
            {r: 128, g: 128, b: 128, a: 255}, // 中灰
            {r: 160, g: 160, b: 160, a: 255}, // 中浅灰
            {r: 192, g: 192, b: 192, a: 255}, // 浅灰
            {r: 224, g: 224, b: 224, a: 255}, // 近白色
            
            // 建筑基础色 - 石材色系
            {r: 200, g: 200, b: 210, a: 255}, // 石灰色 - 略带蓝
            {r: 210, g: 206, b: 200, a: 255}, // 浅石色 - 略带黄
            {r: 180, g: 180, b: 185, a: 255}, // 深石色
            {r: 170, g: 170, b: 170, a: 255}, // 混凝土色
            
            // 木材色系
            {r: 110, g: 80, b: 50, a: 255},   // 深木色
            {r: 160, g: 120, b: 90, a: 255},  // 中木色
            {r: 200, g: 170, b: 120, a: 255}, // 浅木色
            {r: 180, g: 150, b: 100, a: 255}, // 橡木色
            
            // 屋顶蓝色系列 - 特别针对图片中的塔楼屋顶
            {r: 20, g: 80, b: 170, a: 255},   // 深蓝色屋顶
            {r: 30, g: 110, b: 190, a: 255},  // 蓝色屋顶
            {r: 40, g: 130, b: 210, a: 255},  // 亮蓝色屋顶
            {r: 70, g: 160, b: 230, a: 255},  // 天蓝色屋顶
            
            // 旗帜红色系列
            {r: 170, g: 30, b: 30, a: 255},   // 深红色
            {r: 200, g: 50, b: 50, a: 255},   // 红色
            {r: 230, g: 70, b: 70, a: 255},   // 亮红色
            
            // 黄金色系列 - 地基和装饰
            {r: 200, g: 170, b: 50, a: 255},  // 金色
            {r: 230, g: 200, b: 80, a: 255},  // 亮金色
            {r: 170, g: 140, b: 30, a: 255},  // 暗金色
            
            // 绿色系列 - 植被
            {r: 30, g: 120, b: 50, a: 255},   // 深绿色
            {r: 50, g: 150, b: 70, a: 255},   // 绿色
            {r: 70, g: 180, b: 90, a: 255},   // 亮绿色
            
            // 砖红及棕色系列
            {r: 140, g: 80, b: 60, a: 255},   // 砖红色
            {r: 120, g: 60, b: 40, a: 255},   // 深棕色
            {r: 100, g: 50, b: 30, a: 255},   // 暗棕色
            
            // 其他常用基础色
            {r: 255, g: 0, b: 0, a: 255},     // 纯红
            {r: 0, g: 255, b: 0, a: 255},     // 纯绿
            {r: 0, g: 0, b: 255, a: 255},     // 纯蓝
            {r: 255, g: 255, b: 0, a: 255},   // 纯黄
            {r: 0, g: 255, b: 255, a: 255},   // 纯青
            {r: 255, g: 0, b: 255, a: 255},   // 纯紫
        ];
        
        // 收集所有唯一颜色，忽略完全透明的颜色
        const uniqueColors = new Set<string>();
        for (const color of colors) {
            if (color.a === 0) continue;
            const key = `${color.r},${color.g},${color.b},${color.a}`;
            uniqueColors.add(key);
        }
        
        // 如果唯一颜色数量少于限制，直接使用所有颜色
        if (uniqueColors.size <= VoxExporter.MAX_COLORS - basePalette.length) {
            const finalPalette = [...basePalette];
            
            // 添加所有唯一颜色
            uniqueColors.forEach(key => {
                const [r, g, b, a] = key.split(',').map(Number);
                // 检查颜色是否已在基础调色板中
                const colorKey = `${r},${g},${b},${a}`;
                if (!finalPalette.some(c => `${c.r},${c.g},${c.b},${c.a}` === colorKey)) {
                    finalPalette.push({r, g, b, a});
                }
            });
            
            // 创建颜色映射
            const colorMap = new Map<string, number>();
            finalPalette.forEach((color, index) => {
                const key = `${color.r},${color.g},${color.b},${color.a}`;
                colorMap.set(key, index);
            });
            
            return { colorMap, palette: finalPalette };
        }
        
        // 需要进行颜色量化
        console.log(`需要量化颜色: 发现${uniqueColors.size}种颜色，超过限制`);
        
        // 提取所有RGB颜色（不包括透明）
        const rgbColors: {r: number, g: number, b: number, a: number}[] = [];
        const alphaColors: {r: number, g: number, b: number, a: number}[] = [];
        
        uniqueColors.forEach(key => {
            const [r, g, b, a] = key.split(',').map(Number);
            const color = {r, g, b, a};
            if (a < 255) {
                alphaColors.push(color);
            } else {
                rgbColors.push(color);
            }
        });
        
        // 统计每种颜色在模型中的出现次数
        const colorCounts = new Map<string, number>();
        for (const color of colors) {
            if (color.a === 0) continue;
            const key = `${color.r},${color.g},${color.b},${color.a}`;
            colorCounts.set(key, (colorCounts.get(key) || 0) + 1);
        }
        
        // 转换为HSV并按主色调分类
        const colorByHueCategory: {[key: string]: {color: {r: number, g: number, b: number, a: number}, hsv: {h: number, s: number, v: number}, count: number}[]} = {};
        
        // 定义12个色相类别 (每30度一个类别)
        const HUE_CATEGORIES = 12;
        
        for (const color of rgbColors) {
            const key = `${color.r},${color.g},${color.b},${color.a}`;
            const count = colorCounts.get(key) || 0;
            const hsv = this._rgbToHsv(color.r, color.g, color.b);
            
            // 确定色相类别 (0-11)
            const hueCategory = Math.floor(hsv.h / 360 * HUE_CATEGORIES);
            
            if (!colorByHueCategory[hueCategory]) {
                colorByHueCategory[hueCategory] = [];
            }
            
            colorByHueCategory[hueCategory].push({color, hsv, count});
        }
        
        // 最终调色板
        const finalPalette = [...basePalette];
        
        // 为半透明颜色保留位置
        const maxAlphaSlots = Math.min(25, alphaColors.length);
        
        // 计算每个色相类别可以分配的颜色数
        const remainingSlots = VoxExporter.MAX_COLORS - basePalette.length - maxAlphaSlots;
        const categoryCounts = Object.keys(colorByHueCategory).length;
        
        // 每个类别至少分配的颜色数
        let minColorsPerCategory = Math.min(3, Math.floor(remainingSlots / categoryCounts));
        let extraColorsPool = remainingSlots - (minColorsPerCategory * categoryCounts);
        
        // 为每个色相类别分配颜色
        Object.entries(colorByHueCategory).forEach(([categoryKey, categoryColors]) => {
            const hueCategory = parseInt(categoryKey);
            
            // 如果类别为空，跳过
            if (categoryColors.length === 0) return;
            
            // 按照重要性排序 (饱和度*明度*log(count))
            categoryColors.sort((a, b) => {
                const importanceA = (a.hsv.s * 0.7 + 0.3) * (a.hsv.v * 0.7 + 0.3) * Math.log10(1 + a.count);
                const importanceB = (b.hsv.s * 0.7 + 0.3) * (b.hsv.v * 0.7 + 0.3) * Math.log10(1 + b.count);
                return importanceB - importanceA;
            });
            
            // 另外排序分级：按饱和度和亮度划分
            // 分出暗色、中色、亮色各一个代表
            const darkColors = categoryColors.filter(c => c.hsv.v < 0.4).sort((a, b) => b.count - a.count);
            const midColors = categoryColors.filter(c => c.hsv.v >= 0.4 && c.hsv.v < 0.7).sort((a, b) => b.count - a.count);
            const brightColors = categoryColors.filter(c => c.hsv.v >= 0.7).sort((a, b) => b.count - a.count);
            
            // 从每个亮度范围选择代表色
            let selectedCount = 0;
            const selectedColors: {r: number, g: number, b: number, a: number}[] = [];
            
            // 从暗、中、亮各选一个颜色（如果有）
            if (darkColors.length > 0 && selectedCount < minColorsPerCategory) {
                selectedColors.push(darkColors[0].color);
                selectedCount++;
            }
            
            if (midColors.length > 0 && selectedCount < minColorsPerCategory) {
                selectedColors.push(midColors[0].color);
                selectedCount++;
            }
            
            if (brightColors.length > 0 && selectedCount < minColorsPerCategory) {
                selectedColors.push(brightColors[0].color);
                selectedCount++;
            }
            
            // 如果还有额外配额，使用整体排序
            if (extraColorsPool > 0) {
                // 计算这个类别可以额外获得的颜色数量
                // 基于该类别颜色数量在总颜色中的比例
                const categoryTotal = categoryColors.length;
                const totalColors = rgbColors.length;
                
                // 至少1个额外颜色，最多不超过剩余的extraColorsPool
                const extraForThisCategory = Math.min(
                    Math.max(1, Math.round(extraColorsPool * categoryTotal / totalColors)),
                    extraColorsPool
                );
                
                // 选择额外的颜色
                for (let i = 0; i < categoryColors.length && selectedCount < minColorsPerCategory + extraForThisCategory; i++) {
                    const colorEntry = categoryColors[i];
                    const key = `${colorEntry.color.r},${colorEntry.color.g},${colorEntry.color.b},${colorEntry.color.a}`;
                    
                    // 检查是否已选择
                    if (!selectedColors.some(c => `${c.r},${c.g},${c.b},${c.a}` === key)) {
                        selectedColors.push(colorEntry.color);
                        selectedCount++;
                    }
                }
                
                extraColorsPool -= (selectedCount - minColorsPerCategory);
            }
            
            // 添加选定的颜色到最终调色板
            for (const color of selectedColors) {
                const key = `${color.r},${color.g},${color.b},${color.a}`;
                
                // 检查是否已在调色板中
                if (!finalPalette.some(c => `${c.r},${c.g},${c.b},${c.a}` === key)) {
                    finalPalette.push(color);
                }
            }
        });
        
        // 处理蓝色特殊情况 - 确保有足够的蓝色变体用于塔楼屋顶
        const specialBlueIndex = Math.floor(240 / 360 * HUE_CATEGORIES); // 蓝色大约在240度
        if (colorByHueCategory[specialBlueIndex] && colorByHueCategory[specialBlueIndex].length > 0) {
            const blueVariants = colorByHueCategory[specialBlueIndex]
                .filter(entry => entry.hsv.s > 0.5 && entry.hsv.v > 0.5) // 筛选鲜艳的蓝色
                .sort((a, b) => b.count - a.count);
                
            // 添加更多蓝色变体
            for (let i = 0; i < Math.min(5, blueVariants.length); i++) {
                const blueColor = blueVariants[i].color;
                const key = `${blueColor.r},${blueColor.g},${blueColor.b},${blueColor.a}`;
                
                if (!finalPalette.some(c => `${c.r},${c.g},${c.b},${c.a}` === key)) {
                    finalPalette.push(blueColor);
                }
            }
        }
        
        // 如果还有空位，添加半透明颜色
        for (let i = 0; i < maxAlphaSlots && i < alphaColors.length && finalPalette.length < VoxExporter.MAX_COLORS; i++) {
            finalPalette.push(alphaColors[i]);
        }
        
        // 如果仍有空位，填充一些完全生成的渐变色
        if (finalPalette.length < VoxExporter.MAX_COLORS) {
            // 生成一些补充色，确保颜色空间覆盖完整
            // 每60度取一个色相，每个色相取不同饱和度和明度
            for (let h = 0; h < 360 && finalPalette.length < VoxExporter.MAX_COLORS; h += 60) {
                for (let s = 0.3; s <= 1 && finalPalette.length < VoxExporter.MAX_COLORS; s += 0.35) {
                    for (let v = 0.3; v <= 1 && finalPalette.length < VoxExporter.MAX_COLORS; v += 0.35) {
                        const rgb = this._hsvToRgb(h, s, v);
                        const genColor = {r: rgb.r, g: rgb.g, b: rgb.b, a: 255};
                        const key = `${genColor.r},${genColor.g},${genColor.b},${genColor.a}`;
                        
                        if (!finalPalette.some(c => `${c.r},${c.g},${c.b},${c.a}` === key)) {
                            finalPalette.push(genColor);
                        }
                    }
                }
            }
        }
        
        // 创建颜色映射
        const colorMap = new Map<string, number>();
        finalPalette.forEach((color, index) => {
            const key = `${color.r},${color.g},${color.b},${color.a}`;
            colorMap.set(key, index);
        });
        
        console.log(`创建了${finalPalette.length}种颜色的调色板`);
        
        if (uniqueColors.size > VoxExporter.MAX_COLORS) {
            StatusHandler.warning(LOC('something_went_wrong'));
        }
        
        return { colorMap, palette: finalPalette };
    }
    
    /**
     * RGB转HSV
     */
    private _rgbToHsv(r: number, g: number, b: number): {h: number, s: number, v: number} {
        // 归一化RGB值到0-1
        const rn = r / 255;
        const gn = g / 255;
        const bn = b / 255;
        
        const max = Math.max(rn, gn, bn);
        const min = Math.min(rn, gn, bn);
        const delta = max - min;
        
        // 计算HSV
        let h = 0;
        const s = max === 0 ? 0 : delta / max;
        const v = max;
        
        // 计算色相
        if (delta === 0) {
            h = 0; // 灰色
        } else if (max === rn) {
            h = ((gn - bn) / delta) % 6;
        } else if (max === gn) {
            h = (bn - rn) / delta + 2;
        } else {
            h = (rn - gn) / delta + 4;
        }
        
        h = Math.round(h * 60);
        if (h < 0) h += 360;
        
        return {h, s, v};
    }
    
    /**
     * HSV转RGB
     */
    private _hsvToRgb(h: number, s: number, v: number): {r: number, g: number, b: number} {
        const c = v * s;
        const x = c * (1 - Math.abs((h / 60) % 2 - 1));
        const m = v - c;
        
        let r = 0, g = 0, b = 0;
        
        if (h >= 0 && h < 60) {
            r = c; g = x; b = 0;
        } else if (h >= 60 && h < 120) {
            r = x; g = c; b = 0;
        } else if (h >= 120 && h < 180) {
            r = 0; g = c; b = x;
        } else if (h >= 180 && h < 240) {
            r = 0; g = x; b = c;
        } else if (h >= 240 && h < 300) {
            r = x; g = 0; b = c;
        } else {
            r = c; g = 0; b = x;
        }
        
        return {
            r: Math.round((r + m) * 255),
            g: Math.round((g + m) * 255),
            b: Math.round((b + m) * 255)
        };
    }
    
    /**
     * 查找最接近的颜色索引
     */
    private _findClosestColorIndex(targetColor: {r: number, g: number, b: number, a: number}, palette: {r: number, g: number, b: number, a: number}[]): number {
        // 处理透明度特例
        if (targetColor.a < 128) {
            return 0; // 透明色
        }
        
        // 如果使用预设调色板，使用更简单的欧氏距离计算
        if (VoxExporter._usePresetPalette && VoxExporter._presetPalette !== null) {
            let closestIndex = 1; // 默认是白色(索引1)
            let minDistance = Number.MAX_VALUE;
            
            for (let i = 1; i < palette.length; i++) {
                const color = palette[i];
                
                // 计算RGB空间中的欧氏距离
                const distance = Math.sqrt(
                    Math.pow(targetColor.r - color.r, 2) +
                    Math.pow(targetColor.g - color.g, 2) +
                    Math.pow(targetColor.b - color.b, 2)
                );
                
                if (distance < minDistance) {
                    minDistance = distance;
                    closestIndex = i;
                }
            }
            
            return closestIndex;
        }
        
        // 否则使用现有的复杂颜色匹配算法
        // 转换为HSV颜色空间
        const targetHSV = this._rgbToHsv(targetColor.r, targetColor.g, targetColor.b);
        
        // 处理特殊颜色情况
        
        // 1. 蓝色屋顶情况 - 特别处理蓝色，确保蓝色屋顶被正确识别
        const isBlueRoof = targetHSV.h >= 200 && targetHSV.h <= 250 && 
                          targetHSV.s > 0.5 && targetHSV.v > 0.5;
        
        if (isBlueRoof) {
            // 寻找最匹配的蓝色
            let bestBlueIndex = 1; // 默认白色
            let minBlueDiff = Number.MAX_VALUE;
            
            for (let i = 0; i < palette.length; i++) {
                const color = palette[i];
                if (color.a === 0) continue; // 跳过透明色
                
                const hsv = this._rgbToHsv(color.r, color.g, color.b);
                
                // 检查是否为蓝色范围
                if (hsv.h >= 200 && hsv.h <= 250 && hsv.s > 0.4) {
                    // 计算色相、饱和度和明度的加权差值
                    const hueDiff = Math.abs(targetHSV.h - hsv.h) / 50; // 归一化到0-1
                    const satDiff = Math.abs(targetHSV.s - hsv.s);
                    const valDiff = Math.abs(targetHSV.v - hsv.v);
                    
                    // 总差异，明度权重更高
                    const totalDiff = hueDiff * 0.3 + satDiff * 0.3 + valDiff * 0.4;
                    
                    if (totalDiff < minBlueDiff) {
                        minBlueDiff = totalDiff;
                        bestBlueIndex = i;
                    }
                }
            }
            
            // 如果找到了合适的蓝色
            if (minBlueDiff < 0.4) {
                return bestBlueIndex;
            }
        }
        
        // 2. 处理灰度颜色
        const isGrey = targetHSV.s < 0.15;
        
        if (isGrey) {
            // 寻找最接近的灰度
            let bestGreyIndex = 1; // 默认白色
            let minValueDiff = Number.MAX_VALUE;
            
            for (let i = 0; i < palette.length; i++) {
                const color = palette[i];
                // 跳过透明色
                if (color.a === 0) continue;
                
                const hsv = this._rgbToHsv(color.r, color.g, color.b);
                
                // 检查是否为灰色(低饱和度)
                if (hsv.s < 0.15) {
                    const valueDiff = Math.abs(hsv.v - targetHSV.v);
                    if (valueDiff < minValueDiff) {
                        minValueDiff = valueDiff;
                        bestGreyIndex = i;
                    }
                }
            }
            
            if (minValueDiff < 0.15) {
                return bestGreyIndex;
            }
        }
        
        // 3. 处理木材和砖红色系
        const isWoodOrBrick = (targetHSV.h >= 10 && targetHSV.h <= 50) && 
                              targetHSV.s > 0.2 && targetHSV.s < 0.8 &&
                              targetHSV.v > 0.2 && targetHSV.v < 0.8;
                              
        if (isWoodOrBrick) {
            let bestIndex = 1;
            let minDiff = Number.MAX_VALUE;
            
            for (let i = 0; i < palette.length; i++) {
                const color = palette[i];
                if (color.a === 0) continue;
                
                const hsv = this._rgbToHsv(color.r, color.g, color.b);
                
                // 检查是否为木材或砖红色范围
                if (hsv.h >= 10 && hsv.h <= 50 && 
                    hsv.s > 0.2 && hsv.s < 0.8 &&
                    hsv.v > 0.2 && hsv.v < 0.8) {
                    
                    const hueDiff = Math.abs(targetHSV.h - hsv.h) / 40;
                    const satDiff = Math.abs(targetHSV.s - hsv.s);
                    const valDiff = Math.abs(targetHSV.v - hsv.v);
                    
                    const totalDiff = hueDiff * 0.4 + satDiff * 0.3 + valDiff * 0.3;
                    
                    if (totalDiff < minDiff) {
                        minDiff = totalDiff;
                        bestIndex = i;
                    }
                }
            }
            
            if (minDiff < 0.3) {
                return bestIndex;
            }
        }
        
        // 普通颜色匹配逻辑
        let closestIndex = 1; // 默认是白色(索引1)
        let minDistance = Number.MAX_VALUE;
        
        // 透明度敏感匹配
        const isTargetSemiTransparent = targetColor.a >= 128 && targetColor.a < 250;
        
        for (let i = 1; i < palette.length; i++) {
            const color = palette[i];
            
            // 处理透明度匹配
            const isPaletteSemiTransparent = color.a >= 128 && color.a < 250;
            
            // 如果是半透明色，则优先匹配半透明与否相同的颜色
            if (isTargetSemiTransparent !== isPaletteSemiTransparent) {
                continue; // 跳过透明度不匹配的颜色
            }
            
            // HSV颜色空间中的距离计算
            const hsv = this._rgbToHsv(color.r, color.g, color.b);
            
            // 色相距离 (考虑色环特性)
            let hueDiff = Math.abs(targetHSV.h - hsv.h);
            if (hueDiff > 180) hueDiff = 360 - hueDiff;
            
            // 归一化距离分量
            const normHueDiff = hueDiff / 180.0;
            const satDiff = Math.abs(targetHSV.s - hsv.s);
            const valDiff = Math.abs(targetHSV.v - hsv.v);
            
            // 饱和度与明度的权重应根据颜色特性动态调整
            let hueWeight = 1.0;
            let satWeight = 1.0;
            let valWeight = 1.2;
            
            // 对于低饱和度颜色，降低色相重要性，提高明度重要性
            if (targetHSV.s < 0.2 || hsv.s < 0.2) {
                hueWeight = 0.3;
                valWeight = 1.8;
            }
            
            // 对于高饱和度颜色，提高色相重要性
            if (targetHSV.s > 0.7 && hsv.s > 0.7) {
                hueWeight = 1.5;
                satWeight = 0.8;
            }
            
            // 对于暗色，提高饱和度重要性
            if (targetHSV.v < 0.2 || hsv.v < 0.2) {
                satWeight = 0.5;
                valWeight = 1.8;
            }
            
            // 计算加权欧氏距离
            const distance = Math.sqrt(
                hueWeight * normHueDiff * normHueDiff +
                satWeight * satDiff * satDiff +
                valWeight * valDiff * valDiff
            );
            
            if (distance < minDistance) {
                minDistance = distance;
                closestIndex = i;
            }
        }
        
        return closestIndex;
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