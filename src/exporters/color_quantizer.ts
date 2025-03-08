/**
 * Color Quantizer
 * 基于Color Thief项目的MMCQ（中位切分量化）算法
 * 原始代码: https://github.com/lokesh/color-thief/
 * 
 * 已转换为TypeScript并适配到本项目
 */

// 私有工具函数
class ColorUtils {
    // 获取像素在数组中的索引位置
    static getColorIndex(r: number, g: number, b: number, a: number): number {
        return (r << 24) | (g << 16) | (b << 8) | a;
    }

    // 获取颜色的亮度值
    static getColorBrightness(r: number, g: number, b: number): number {
        // 使用相对亮度公式: 0.2126*R + 0.7152*G + 0.0722*B
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
}

// 颜色立方体类，表示RGB颜色空间中的一个区域
class ColorCube {
    private _colors: {r: number, g: number, b: number, a: number}[];
    private _rMin: number = 0;
    private _rMax: number = 0;
    private _gMin: number = 0;
    private _gMax: number = 0;
    private _bMin: number = 0;
    private _bMax: number = 0;
    private _volume: number = 0;
    private _count: number = 0;
    private _averageColor: {r: number, g: number, b: number, a: number} | null = null;

    constructor(colors: {r: number, g: number, b: number, a: number}[]) {
        this._colors = colors;
        this._count = colors.length;
        this._calculateBounds();
        this._calculateVolume();
    }

    // 计算立方体的边界
    private _calculateBounds(): void {
        let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;

        for (const color of this._colors) {
            rMin = Math.min(rMin, color.r);
            rMax = Math.max(rMax, color.r);
            gMin = Math.min(gMin, color.g);
            gMax = Math.max(gMax, color.g);
            bMin = Math.min(bMin, color.b);
            bMax = Math.max(bMax, color.b);
        }

        this._rMin = rMin;
        this._rMax = rMax;
        this._gMin = gMin;
        this._gMax = gMax;
        this._bMin = bMin;
        this._bMax = bMax;
    }

    // 计算立方体的体积
    private _calculateVolume(): void {
        const rLength = this._rMax - this._rMin + 1;
        const gLength = this._gMax - this._gMin + 1;
        const bLength = this._bMax - this._bMin + 1;
        this._volume = rLength * gLength * bLength;
    }

    // 获取立方体的体积
    public get volume(): number {
        return this._volume;
    }

    // 获取立方体中的颜色数量
    public get count(): number {
        return this._count;
    }

    // 获取立方体的平均颜色
    public get averageColor(): {r: number, g: number, b: number, a: number} {
        if (this._averageColor === null) {
            let r = 0, g = 0, b = 0, a = 0;
            
            for (const color of this._colors) {
                r += color.r;
                g += color.g;
                b += color.b;
                a += color.a;
            }
            
            const count = this._colors.length;
            this._averageColor = {
                r: Math.round(r / count),
                g: Math.round(g / count),
                b: Math.round(b / count),
                a: Math.round(a / count)
            };
        }
        
        return this._averageColor;
    }

    // 获取立方体的最长边
    public get longestDimension(): 'r' | 'g' | 'b' {
        const rLength = this._rMax - this._rMin;
        const gLength = this._gMax - this._gMin;
        const bLength = this._bMax - this._bMin;
        
        if (rLength >= gLength && rLength >= bLength) {
            return 'r';
        } else if (gLength >= rLength && gLength >= bLength) {
            return 'g';
        } else {
            return 'b';
        }
    }

    // 沿最长边切分立方体
    public split(): [ColorCube, ColorCube] {
        if (this._count === 0) {
            throw new Error('Cannot split an empty cube');
        }
        
        if (this._count === 1) {
            throw new Error('Cannot split a cube with only one color');
        }
        
        // 按最长边排序
        const dimension = this.longestDimension;
        this._colors.sort((a, b) => a[dimension] - b[dimension]);
        
        // 找到中点
        const midIndex = Math.floor(this._count / 2);
        
        // 分割为两个立方体
        const cube1 = new ColorCube(this._colors.slice(0, midIndex));
        const cube2 = new ColorCube(this._colors.slice(midIndex));
        
        return [cube1, cube2];
    }
}

// 主要的MMCQ算法类
export class ColorQuantizer {
    /**
     * 从颜色数组中提取调色板
     * @param colors 颜色数组
     * @param maxColors 最大颜色数量
     * @returns 调色板颜色数组
     */
    public static quantize(
        colors: {r: number, g: number, b: number, a: number}[],
        maxColors: number
    ): {r: number, g: number, b: number, a: number}[] {
        // 过滤掉透明颜色
        const validColors = colors.filter(color => color.a > 128);
        
        // 如果颜色数量小于等于最大颜色数，直接返回
        if (validColors.length <= maxColors) {
            return validColors;
        }
        
        // 创建初始立方体
        const initialCube = new ColorCube(validColors);
        
        // 使用优先队列（按体积排序）
        const cubes: ColorCube[] = [initialCube];
        
        // 分割立方体直到达到所需的颜色数量
        while (cubes.length < maxColors) {
            // 按体积排序，分割最大的立方体
            cubes.sort((a, b) => b.volume - a.volume);
            
            const largestCube = cubes.shift();
            if (!largestCube || largestCube.count <= 1) {
                break; // 无法继续分割
            }
            
            try {
                // 分割立方体
                const [cube1, cube2] = largestCube.split();
                cubes.push(cube1, cube2);
            } catch (e) {
                // 如果无法分割，则跳过
                break;
            }
        }
        
        // 从每个立方体中提取平均颜色
        const palette = cubes.map(cube => cube.averageColor);
        
        // 确保调色板不超过最大颜色数
        return palette.slice(0, maxColors);
    }
    
    /**
     * 从颜色数组中提取调色板，并确保包含一些关键颜色
     * @param colors 颜色数组
     * @param maxColors 最大颜色数量
     * @param keyColors 必须包含的关键颜色
     * @returns 调色板颜色数组
     */
    public static quantizeWithKeyColors(
        colors: {r: number, g: number, b: number, a: number}[],
        maxColors: number,
        keyColors: {r: number, g: number, b: number, a: number}[]
    ): {r: number, g: number, b: number, a: number}[] {
        // 确保关键颜色不超过最大颜色数
        const safeKeyColors = keyColors.slice(0, maxColors);
        
        // 计算剩余可用的颜色数量
        const remainingSlots = maxColors - safeKeyColors.length;
        
        if (remainingSlots <= 0) {
            return safeKeyColors; // 如果关键颜色已经填满调色板，直接返回
        }
        
        // 量化剩余的颜色
        const quantizedColors = this.quantize(colors, remainingSlots);
        
        // 合并关键颜色和量化的颜色
        return [...safeKeyColors, ...quantizedColors];
    }
    
    /**
     * 查找最接近目标颜色的调色板索引
     * @param targetColor 目标颜色
     * @param palette 调色板
     * @returns 最接近的颜色索引
     */
    public static findClosestColorIndex(
        targetColor: {r: number, g: number, b: number, a: number},
        palette: {r: number, g: number, b: number, a: number}[]
    ): number {
        // 处理透明度特例
        if (targetColor.a < 128) {
            return 0; // 透明色
        }
        
        let closestIndex = 0;
        let minDistance = Number.MAX_VALUE;
        
        for (let i = 0; i < palette.length; i++) {
            const color = palette[i];
            
            // 跳过透明色
            if (color.a < 128) continue;
            
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
} 