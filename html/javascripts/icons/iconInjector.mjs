// Icon Injector - injects icons from the icon registry into HTML elements
// This allows index.html to use data attributes to specify icons without hardcoding SVGs

import { ICONS } from './iconRegistry.mjs';

export function initializeIconInjection() {
	// Find all elements with data-icon attribute and inject the corresponding SVG
	const elementsWithIcons = document.querySelectorAll('[data-icon]');
	
	for (const element of elementsWithIcons) {
		const iconName = element.dataset.icon;
		const iconSvg = ICONS[iconName];
		
		if (iconSvg) {
			// Insert icon as first child (before text content)
			const tempDiv = document.createElement('div');
			tempDiv.innerHTML = iconSvg;
			const svgElement = tempDiv.firstElementChild;
			element.insertBefore(svgElement, element.firstChild);
		}
	}
}
