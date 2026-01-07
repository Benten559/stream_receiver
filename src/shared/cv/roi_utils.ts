/**
 * ROI (Region of Interest) Utilities
 * Functions for applying ROI and exclusion zone filtering
 */

import type { DetectedMarker, ROI, ExclusionZone, Point, DetectedHole } from './types.ts';

/**
 * Calculate ROI from fiducial markers 0-3
 * Marker layout:
 * 0 (top-left) ---- 1 (top-right)
 * |                 |
 * 2 (bottom-left) - 3 (bottom-right)
 */
export function calculateROI(
    markers: DetectedMarker[],
    exclusionPadding: number = 5
): ROI | null {
    // Filter for markers 0-3
    const markersMap = new Map<number, DetectedMarker>();
    for (const marker of markers) {
        if ([0, 1, 2, 3].includes(marker.id)) {
            markersMap.set(marker.id, marker);
        }
    }

    // Need all 4 markers to define ROI
    if (markersMap.size !== 4) {
        return null;
    }

    const marker0 = markersMap.get(0)!;
    const marker1 = markersMap.get(1)!;
    const marker2 = markersMap.get(2)!;
    const marker3 = markersMap.get(3)!;

    // Order corners spatially for proper quadrilateral
    const corners = [
        marker0.center, // top-left
        marker1.center, // top-right
        marker3.center, // bottom-right
        marker2.center, // bottom-left
    ];

    // Calculate bounding box
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);

    // Create exclusion zones for each marker
    const exclusionZones: ExclusionZone[] = [];

    for (const marker of [marker0, marker1, marker2, marker3]) {
        const markerXs = marker.corners.map((c) => c.x);
        const markerYs = marker.corners.map((c) => c.y);

        exclusionZones.push({
            minX: Math.floor(Math.min(...markerXs)) - exclusionPadding,
            maxX: Math.ceil(Math.max(...markerXs)) + exclusionPadding,
            minY: Math.floor(Math.min(...markerYs)) - exclusionPadding,
            maxY: Math.ceil(Math.max(...markerYs)) + exclusionPadding,
        });
    }

    return {
        minX: Math.floor(Math.min(...xs)),
        maxX: Math.ceil(Math.max(...xs)),
        minY: Math.floor(Math.min(...ys)),
        maxY: Math.ceil(Math.max(...ys)),
        corners,
        exclusionZones,
    };
}

/**
 * Check if point is inside quadrilateral using ray casting
 */
export function isPointInQuad(x: number, y: number, corners: Point[]): boolean {
    if (corners.length !== 4) return false;

    let inside = false;
    for (let i = 0, j = 3; i < 4; j = i++) {
        const xi = corners[i]!.x;
        const yi = corners[i]!.y;
        const xj = corners[j]!.x;
        const yj = corners[j]!.y;

        const intersect =
            yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

        if (intersect) inside = !inside;
    }

    return inside;
}

/**
 * Check if point is inside any exclusion zone
 */
export function isInExclusionZone(
    x: number,
    y: number,
    exclusionZones: ExclusionZone[]
): boolean {
    for (const zone of exclusionZones) {
        if (x >= zone.minX && x <= zone.maxX && y >= zone.minY && y <= zone.maxY) {
            return true;
        }
    }
    return false;
}

/**
 * Filter detected holes by ROI and exclusion zones
 */
export function filterHolesByROI(
    holes: DetectedHole[],
    roi: ROI | null
): DetectedHole[] {
    if (!roi) {
        return holes; // No filtering if no ROI
    }

    return holes.filter((hole) => {
        const { x, y } = hole.center;

        // Check if inside ROI quadrilateral
        if (!isPointInQuad(x, y, roi.corners)) {
            return false;
        }

        // Check if inside exclusion zone
        if (isInExclusionZone(x, y, roi.exclusionZones)) {
            return false;
        }

        return true;
    });
}
