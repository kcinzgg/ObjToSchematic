import fs from 'fs';

import { getRandomID } from '../../util';
import { ASSERT } from '../../util/error_util';
import { AppPaths } from '../../util/path_util';
import { PathUtil } from '../../util/path_util';

export type TToolbarBooleanProperty = 'enabled' | 'active';

export type TToolbarItemParams = {
    icon: string;
}

export class ToolbarItemElement {
    private _id: string;
    private _iconName: string;
    private _iconPath: string;
    private _isEnabled: boolean;
    private _isActive: boolean;
    private _isHovering: boolean;
    private _onClick?: () => void;

    public constructor(params: TToolbarItemParams) {
        this._id = getRandomID();

        this._iconName = params.icon;
        this._iconPath = PathUtil.join(AppPaths.Get.static, params.icon + '.svg');

        this._isEnabled = true;
        this._isActive = false;
        this._isHovering = false;
    }

    public tick() {
        if (this._isEnabledDelegate !== undefined) {
            const newIsEnabled = this._isEnabledDelegate();
            if (newIsEnabled !== this._isEnabled) {
                this.setEnabled(newIsEnabled);
            }
        }

        if (this._isActiveDelegate !== undefined) {
            const newIsActive = this._isActiveDelegate();
            if (newIsActive !== this._isActive) {
                this.setActive(newIsActive);
            }
        }
    }

    private _isActiveDelegate?: () => boolean;
    public isActive(delegate: () => boolean) {
        this._isActiveDelegate = delegate;
        return this;
    }

    private _isEnabledDelegate?: () => boolean;
    public isEnabled(delegate: () => boolean) {
        this._isEnabledDelegate = delegate;
        return this;
    }

    public onClick(delegate: () => void) {
        this._onClick = delegate;

        return this;
    }

    public generateHTML() {
        const svg = fs.readFileSync(this._iconPath, 'utf8');
        return `
            <div class="toolbar-item" id="${this._id}">
                ${svg}
            </div>
        `;
    }

    public registerEvents(): void {
        const element = document.getElementById(this._id) as HTMLDivElement;
        ASSERT(element !== null);

        element.addEventListener('click', () => {
            if (this._isEnabled && this._onClick) {
                this._onClick();
            }
        });

        element.addEventListener('mouseenter', () => {
            this._isHovering = true;
            this._updateElements();
        });

        element.addEventListener('mouseleave', () => {
            this._isHovering = false;
            this._updateElements();
        });

        this._updateElements();
    }

    private _updateElements() {
        const element = document.getElementById(this._id) as HTMLDivElement;
        const svgElement = document.getElementById(this._iconName + '-svg') as HTMLDivElement;
        ASSERT(element !== null && svgElement !== null);

        element.classList.remove('toolbar-item-active-hover');
        element.classList.remove('toolbar-item-disabled');
        element.classList.remove('toolbar-item-active');
        element.classList.remove('toolbar-item-hover');
        svgElement.classList.remove('icon-disabled');
        svgElement.classList.remove('icon-active');

        if (this._isEnabled) {
            if (this._isActive) {
                if (this._isHovering) {
                    element.classList.add('toolbar-item-active-hover');
                } else {
                    element.classList.add('toolbar-item-active');
                }
                svgElement.classList.add('icon-active');
            } else {
                if (this._isHovering) {
                    element.classList.add('toolbar-item-hover');
                }
            }
        } else {
            element.classList.add('toolbar-item-disabled');
            svgElement.classList.add('icon-disabled');
        }
    }

    public setEnabled(isEnabled: boolean) {
        this._isEnabled = isEnabled;
        this._updateElements();
    }

    public setActive(isActive: boolean) {
        this._isActive = isActive;
        this._updateElements();
    }
}
