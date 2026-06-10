/**
 * Page curl calculation.
 *
 * MIT attribution: derived from StPageFlip by Nodlik
 * (https://github.com/Nodlik/StPageFlip), MIT License.
 * Optimizations from SAILgaosai/StPageFlip fork.
 * Soft-cover clip from maxfahl/PageFlip.
 */

import { curlAssert } from './types';

// ---- Types ----

export interface Point {
    x: number;
    y: number;
}

export interface PageRect {
    width: number;
    height: number;
}

interface RectPoints {
    topLeft: Point;
    topRight: Point;
    bottomLeft: Point;
    bottomRight: Point;
}

interface Rect {
    left: number;
    top: number;
    width: number;
    height: number;
}

type Segment = [Point, Point];

type FlipCorner = 'top' | 'bottom';

export interface CurlResult {
    angle: number;
    progress: number;
    flippingClipArea: Point[];
    bottomClipArea: Point[];
    currentClipArea: Point[];
    flippingPosition: Point;
    shadow: {
        pos: Point;
        angle: number;
        progress: number;
    };
}

// ---- Geometry helpers (ported from Helper.ts) ----

const distanceBetween = (p1: Point | null, p2: Point | null): number => {
    if (p1 === null || p2 === null) return Infinity;
    return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
};

const angleBetweenLines = (line1: Segment, line2: Segment): number => {
    const A1 = line1[0].y - line1[1].y;
    const A2 = line2[0].y - line2[1].y;
    const B1 = line1[1].x - line1[0].x;
    const B2 = line2[1].x - line2[0].x;
    return Math.acos(
        (A1 * A2 + B1 * B2) /
        (Math.sqrt(A1 * A1 + B1 * B1) * Math.sqrt(A2 * A2 + B2 * B2))
    );
};

const pointInRect = (rect: Rect, pos: Point | null): Point | null => {
    if (pos === null) return null;
    if (
        pos.x >= rect.left &&
        pos.x <= rect.width + rect.left &&
        pos.y >= rect.top &&
        pos.y <= rect.top + rect.height
    ) {
        return pos;
    }
    return null;
};

const lineIntersection = (one: Segment, two: Segment): Point | null => {
    const A1 = one[0].y - one[1].y;
    const A2 = two[0].y - two[1].y;
    const B1 = one[1].x - one[0].x;
    const B2 = two[1].x - two[0].x;
    const C1 = one[0].x * one[1].y - one[1].x * one[0].y;
    const C2 = two[0].x * two[1].y - two[1].x * two[0].y;

    const x = -((C1 * B2 - C2 * B1) / (A1 * B2 - A2 * B1));
    const y = -((A1 * C2 - A2 * C1) / (A1 * B2 - A2 * B1));

    if (isFinite(x) && isFinite(y)) {
        return { x, y };
    }
    // Coincident/degenerate lines — no meaningful intersection.
    // Original StPageFlip threw here, but that can escape through
    // segmentIntersection into calcCurlRaw where it's not caught.
    return null;
};

const segmentIntersection = (rectBorder: Rect, one: Segment, two: Segment): Point | null => {
    return pointInRect(rectBorder, lineIntersection(one, two));
};

const limitPointToCircle = (center: Point, radius: number, point: Point): Point => {
    if (distanceBetween(center, point) <= radius) {
        return point;
    }

    const a = center.x;
    const b = center.y;
    const n = point.x;
    const m = point.y;

    let x = Math.sqrt((radius ** 2 * (a - n) ** 2) / ((a - n) ** 2 + (b - m) ** 2)) + a;
    if (point.x < 0) {
        x *= -1;
    }

    let y = ((x - a) * (b - m)) / (a - n) + b;
    if (a - n + b === 0) {
        y = radius;
    }

    return { x, y };
};

const rotatePoint = (point: Point, origin: Point, angle: number): Point => ({
    x: point.x * Math.cos(angle) + point.y * Math.sin(angle) + origin.x,
    y: point.y * Math.cos(angle) - point.x * Math.sin(angle) + origin.y,
});

// ---- Raw curl calculation (ported from FlipCalculation.ts) ----

/**
 * Raw port of StPageFlip's FlipCalculation.
 *
 * Coordinate system (StPageFlip native):
 * - Origin at top-left of active page (spine corner)
 * - X: 0 at spine, positive toward outer edge
 * - Y: 0 at top, positive downward
 * - pageWidth = half-book width (one page)
 *
 * @param pos - Touch/drag point in page-local coords
 * @param pageWidth - Width of one page
 * @param pageHeight - Height of one page
 * @param direction - 'next' (FORWARD) or 'previous' (BACK)
 * @param corner - 'top' or 'bottom' corner being dragged
 * @returns CurlResult with all geometry in the same coordinate system
 */
export const calcCurlRaw = (
    pos: Point,
    pageWidth: number,
    pageHeight: number,
    direction: 'next' | 'previous',
    corner: FlipCorner,
): CurlResult | null => {
    // --- Calculate angle and constrained position ---
    let angle = 0;
    let rect: RectPoints = { topLeft: { x: 0, y: 0 }, topRight: { x: 0, y: 0 }, bottomLeft: { x: 0, y: 0 }, bottomRight: { x: 0, y: 0 } };
    let position: Point;

    const updateAngleAndGeometry = (p: Point): void => {
        angle = calculateAngle(p, pageWidth, pageHeight, corner);
        rect = getPageRect(p, pageWidth, pageHeight, angle, corner);
    };

    try {
        position = pos;
        updateAngleAndGeometry(position);

        // Constrain to center line
        if (corner === 'top') {
            position = checkPositionAtCenterLine(
                position, { x: 0, y: 0 }, { x: 0, y: pageHeight },
                pageWidth, pageHeight, corner, updateAngleAndGeometry
            );
        } else {
            position = checkPositionAtCenterLine(
                position, { x: 0, y: pageHeight }, { x: 0, y: 0 },
                pageWidth, pageHeight, corner, updateAngleAndGeometry
            );
        }

        // No visible curl when position is at (or very near) the page corner.
        // Top corner: x ≈ pageWidth, y ≈ 0
        if (Math.abs(position.x - pageWidth) < 1 && Math.abs(position.y) < 1) {
            return null;
        }
        // Bottom corner: x ≈ pageWidth, y ≈ pageHeight
        if (Math.abs(position.x - pageWidth) < 1 && Math.abs(position.y - pageHeight) < 1) {
            return null;
        }
    } catch {
        return null;
    }

    // --- Calculate intersection points ---
    let topIntersectPoint: Point | null = null;
    let sideIntersectPoint: Point | null = null;
    let bottomIntersectPoint: Point | null = null;

    const boundRect: Rect = {
        left: -1,
        top: -1,
        width: pageWidth + 2,
        height: pageHeight + 2,
    };

    if (corner === 'top') {
        topIntersectPoint = segmentIntersection(
            boundRect,
            [position, rect.topRight],
            [{ x: 0, y: 0 }, { x: pageWidth, y: 0 }]
        );
        sideIntersectPoint = segmentIntersection(
            boundRect,
            [position, rect.bottomLeft],
            [{ x: pageWidth, y: 0 }, { x: pageWidth, y: pageHeight }]
        );
        bottomIntersectPoint = segmentIntersection(
            boundRect,
            [rect.bottomLeft, rect.bottomRight],
            [{ x: 0, y: pageHeight }, { x: pageWidth, y: pageHeight }]
        );
    } else {
        topIntersectPoint = segmentIntersection(
            boundRect,
            [rect.topLeft, rect.topRight],
            [{ x: 0, y: 0 }, { x: pageWidth, y: 0 }]
        );
        sideIntersectPoint = segmentIntersection(
            boundRect,
            [position, rect.topLeft],
            [{ x: pageWidth, y: 0 }, { x: pageWidth, y: pageHeight }]
        );
        bottomIntersectPoint = segmentIntersection(
            boundRect,
            [rect.bottomLeft, rect.bottomRight],
            [{ x: 0, y: pageHeight }, { x: pageWidth, y: pageHeight }]
        );
    }

    // --- Build clip areas ---
    const flippingClipArea = buildFlippingClipArea(
        rect, topIntersectPoint, sideIntersectPoint, bottomIntersectPoint, corner
    );

    const bottomClipArea = buildBottomClipArea(
        topIntersectPoint, sideIntersectPoint, bottomIntersectPoint,
        pageWidth, pageHeight, corner
    );

    const currentClipArea = buildCurrentClipArea(
        topIntersectPoint, sideIntersectPoint, bottomIntersectPoint,
        pageWidth, pageHeight
    );

    // --- Shadow data ---
    const shadowStartPoint = corner === 'top'
        ? topIntersectPoint
        : (sideIntersectPoint ?? topIntersectPoint);

    const shadowSegmentEnd = (shadowStartPoint !== sideIntersectPoint && sideIntersectPoint !== null)
        ? sideIntersectPoint
        : bottomIntersectPoint;

    // Guard: if intersection points are missing, shadow can't be computed
    if (shadowStartPoint === null || shadowSegmentEnd === null) {
        return null;
    }

    const shadowAngleRaw = angleBetweenLines(
        [shadowStartPoint, shadowSegmentEnd],
        [{ x: 0, y: 0 }, { x: pageWidth, y: 0 }]
    );

    const shadowAngle = direction === 'next' ? shadowAngleRaw : Math.PI - shadowAngleRaw;

    // --- Result ---
    const resultAngle = direction === 'next' ? -angle : angle;
    // Normalized to 0..1 (master plan contract). StPageFlip uses 0-100 — we divide by 100.
    const progress = Math.abs((position.x - pageWidth) / (2 * pageWidth));

    return {
        angle: resultAngle,
        progress,
        flippingClipArea,
        bottomClipArea,
        currentClipArea,
        flippingPosition: position,
        shadow: {
            pos: shadowStartPoint,
            angle: shadowAngle,
            progress,
        },
    };
};

// ---- Internal helpers for calcCurlRaw ----

const calculateAngle = (
    pos: Point, pageWidth: number, pageHeight: number, corner: FlipCorner,
): number => {
    const left = pageWidth - pos.x + 1;
    const top = corner === 'bottom' ? pageHeight - pos.y : pos.y;

    let a = 2 * Math.acos(left / Math.sqrt(top * top + left * left));
    if (top < 0) a = -a;

    const da = Math.PI - a;
    if (!isFinite(a) || (da >= 0 && da < 0.003)) {
        throw new Error('The G point is too small');
    }

    if (corner === 'bottom') a = -a;
    return a;
};

const getPageRect = (
    pos: Point, pageWidth: number, pageHeight: number, angle: number, corner: FlipCorner,
): RectPoints => {
    const points: Point[] = corner === 'top'
        ? [
            { x: 0, y: 0 },
            { x: pageWidth, y: 0 },
            { x: 0, y: pageHeight },
            { x: pageWidth, y: pageHeight },
        ]
        : [
            { x: 0, y: -pageHeight },
            { x: pageWidth, y: -pageHeight },
            { x: 0, y: 0 },
            { x: pageWidth, y: 0 },
        ];

    return {
        topLeft: rotatePoint(points[0], pos, angle),
        topRight: rotatePoint(points[1], pos, angle),
        bottomLeft: rotatePoint(points[2], pos, angle),
        bottomRight: rotatePoint(points[3], pos, angle),
    };
};

const checkPositionAtCenterLine = (
    checkedPos: Point,
    centerOne: Point,
    centerTwo: Point,
    pageWidth: number,
    pageHeight: number,
    corner: FlipCorner,
    updateFn: (p: Point) => void,
): Point => {
    let result = checkedPos;

    const tmp = limitPointToCircle(centerOne, pageWidth, result);
    if (result !== tmp) {
        result = tmp;
        updateFn(result);
    }

    const rad = Math.sqrt(pageWidth ** 2 + pageHeight ** 2);

    // Re-read rect after possible update — updateFn sets the outer `rect` variable
    // We need the current rect, so we recalculate it here
    const currentAngle = calculateAngle(result, pageWidth, pageHeight, corner);
    const currentRect = getPageRect(result, pageWidth, pageHeight, currentAngle, corner);

    let checkPointOne = currentRect.bottomRight;
    let checkPointTwo = currentRect.topLeft;

    if (corner === 'bottom') {
        checkPointOne = currentRect.topRight;
        checkPointTwo = currentRect.bottomLeft;
    }

    if (checkPointOne.x <= 0) {
        const bottomPoint = limitPointToCircle(centerTwo, rad, checkPointTwo);
        if (bottomPoint !== result) {
            result = bottomPoint;
            updateFn(result);
        }
    }

    return result;
};

const buildFlippingClipArea = (
    rect: RectPoints,
    topIntersect: Point | null,
    sideIntersect: Point | null,
    bottomIntersect: Point | null,
    corner: FlipCorner,
): Point[] => {
    const result: Point[] = [];
    let clipBottom = false;

    result.push(rect.topLeft);
    if (topIntersect) result.push(topIntersect);

    if (sideIntersect === null) {
        clipBottom = true;
    } else {
        result.push(sideIntersect);
        if (bottomIntersect === null) clipBottom = false;
    }

    if (bottomIntersect) result.push(bottomIntersect);

    if (clipBottom || corner === 'bottom') {
        result.push(rect.bottomLeft);
    }

    return result;
};

const buildBottomClipArea = (
    topIntersect: Point | null,
    sideIntersect: Point | null,
    bottomIntersect: Point | null,
    pageWidth: number,
    pageHeight: number,
    corner: FlipCorner,
): Point[] => {
    const result: Point[] = [];

    if (topIntersect) result.push(topIntersect);

    if (corner === 'top') {
        result.push({ x: pageWidth, y: 0 });
    } else {
        if (topIntersect !== null) {
            result.push({ x: pageWidth, y: 0 });
        }
        result.push({ x: pageWidth, y: pageHeight });
    }

    if (sideIntersect !== null) {
        if (distanceBetween(sideIntersect, topIntersect) >= 10) {
            result.push(sideIntersect);
        }
    } else {
        if (corner === 'top') {
            result.push({ x: pageWidth, y: pageHeight });
        }
    }

    if (bottomIntersect) result.push(bottomIntersect);
    if (topIntersect) result.push(topIntersect);

    return result;
};

const buildCurrentClipArea = (
    topIntersect: Point | null,
    sideIntersect: Point | null,
    bottomIntersect: Point | null,
    pageWidth: number,
    pageHeight: number,
): Point[] => {
    const result: Point[] = [];

    const startPoint = topIntersect ?? { x: pageWidth, y: 0 };

    result.push(startPoint);
    result.push({ x: 0, y: 0 });
    result.push({ x: 0, y: pageHeight });
    result.push(bottomIntersect ?? { x: pageWidth, y: pageHeight });
    if (sideIntersect) {
        result.push(sideIntersect);
    }
    result.push(startPoint);

    return result;
};

// ---- Coordinate adapter ----

/**
 * Public API: calcCurl.
 *
 * Our system's page-local coordinates:
 * - For 'next' (right page curling left): origin at page's LEFT edge (spine side).
 *   x=0 is spine, x=pageWidth is outer edge. Same as StPageFlip's native system.
 * - For 'previous' (left page curling right): origin at page's RIGHT edge (spine side).
 *   x=0 is spine, x=pageWidth is outer edge. StPageFlip handles this via direction.
 *
 * Since our page-local origin matches StPageFlip's native origin (spine corner),
 * the adapter is a passthrough for coordinates. The only adaptation is:
 * - We always use corner='bottom' (drag from bottom corners — most natural for magazines)
 * - We normalize the CurlResult for our renderer
 */
export const calcCurl = (
    dragPoint: Point,
    pageRect: PageRect,
    direction: 'next' | 'previous',
): CurlResult | null => {
    curlAssert(
        pageRect.width > 0 && pageRect.height > 0,
        'calcCurl',
        'pageRect has zero or negative dimensions',
        { width: pageRect.width, height: pageRect.height },
    );
    curlAssert(
        isFinite(dragPoint.x) && isFinite(dragPoint.y),
        'calcCurl',
        'dragPoint contains non-finite values',
        { x: dragPoint.x, y: dragPoint.y },
    );

    const result = calcCurlRaw(dragPoint, pageRect.width, pageRect.height, direction, 'bottom');

    if (result) {
        curlAssert(
            isFinite(result.angle) && isFinite(result.progress),
            'calcCurl',
            'result contains non-finite angle or progress',
            { angle: result.angle, progress: result.progress },
        );
        curlAssert(
            result.progress >= 0 && result.progress <= 1.01,
            'calcCurl',
            'progress out of expected 0..1 range',
            { progress: result.progress },
        );
        curlAssert(
            result.flippingClipArea.length >= 3,
            'calcCurl',
            'flippingClipArea has fewer than 3 points — cannot form a polygon',
            { pointCount: result.flippingClipArea.length },
        );
        curlAssert(
            result.bottomClipArea.length >= 3,
            'calcCurl',
            'bottomClipArea has fewer than 3 points',
            { pointCount: result.bottomClipArea.length },
        );
    }

    return result;
};
