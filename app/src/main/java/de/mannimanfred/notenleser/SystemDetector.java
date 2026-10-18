package de.mannimanfred.notenleser;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * Finds five-line staves on a rendered score page and groups them into systems.
 *
 * Staff lines are searched locally in narrow vertical strips, so indented, shortened or slightly skewed staves are
 * found as well. Adjacent staves belong to the same system when they are joined on the left (system barline, bracket
 * or brace) or by a barline through the gap. Plain Java without Android dependencies so it can be tested on the
 * desktop.
 */
final class SystemDetector {
    private static final int DARK_LUMINANCE = 200;

    static final class Result {
        final int[] top, bottom, staffCount;
        /** Top and bottom staff line of every found staff from top to bottom of the page. */
        final int[] staffTop, staffBottom;
        Result(int[] top, int[] bottom, int[] staffCount, int[] staffTop, int[] staffBottom) {
            this.top = top; this.bottom = bottom; this.staffCount = staffCount;
            this.staffTop = staffTop; this.staffBottom = staffBottom;
        }
    }

    /** A staff follows its strip detections piecewise linearly, so slightly curved scans are tracked too. */
    private static final class Staff {
        float[] xs, tops;
        final float height;
        final int strips;
        int left, right;
        int[] bars = new int[0];
        Staff(float[] xs, float[] tops, float height) { this.xs = xs; this.tops = tops; this.height = height; strips = xs.length; }
        /** Adds the traced line ends, given with their drift from the outermost strip detections. */
        void extend(int left, int leftDrift, int right, int rightDrift) {
            this.left = left; this.right = right;
            int n = xs.length;
            float[] newXs = new float[n + 2], newTops = new float[n + 2];
            System.arraycopy(xs, 0, newXs, 1, n);
            System.arraycopy(tops, 0, newTops, 1, n);
            newXs[0] = Math.min(left, xs[0] - 1); newTops[0] = tops[0] + leftDrift;
            newXs[n + 1] = Math.max(right, xs[n - 1] + 1); newTops[n + 1] = tops[n - 1] + rightDrift;
            xs = newXs; tops = newTops;
        }
        float topAt(float x) {
            int n = xs.length;
            if (n == 1 || x <= xs[0]) return tops[0];
            if (x >= xs[n - 1]) return tops[n - 1];
            int i = 1;
            while (xs[i] < x) i++;
            float t = (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
            return tops[i - 1] + t * (tops[i] - tops[i - 1]);
        }
        float bottomAt(float x) { return topAt(x) + height; }
        float spacing() { return height / 4f; }
        int minTop() { float min = Float.MAX_VALUE; for (float top : tops) min = Math.min(min, top); return Math.round(min); }
        int maxBottom() { float max = 0; for (float top : tops) max = Math.max(max, top); return Math.round(max + height); }
    }

    private final int width, height;
    private final boolean[] dark;

    private SystemDetector(int[] pixels, int width, int height) {
        this.width = width; this.height = height;
        dark = new boolean[width * height];
        for (int i = 0; i < dark.length; i++) {
            int c = pixels[i];
            int luminance = (((c >> 16) & 255) * 299 + ((c >> 8) & 255) * 587 + (c & 255) * 114) / 1000;
            dark[i] = luminance < DARK_LUMINANCE;
        }
    }

    static Result detect(int[] pixels, int width, int height) {
        return new SystemDetector(pixels, width, height).run();
    }

    private boolean isDark(int x, int y) { return x >= 0 && x < width && y >= 0 && y < height && dark[y * width + x]; }

    private Result run() {
        float spacing = estimateSpacing();
        if (spacing <= 0) return empty();
        List<Staff> staffs = findStaffs(spacing);
        if (staffs.isEmpty()) return empty();
        for (int i = 0; i < staffs.size(); i++) {
            findBarlines(staffs.get(i), i > 0 ? staffs.get(i - 1) : null, i + 1 < staffs.size() ? staffs.get(i + 1) : null);
        }

        List<int[]> groups = new ArrayList<>(); // {firstStaff, lastStaff}
        int first = 0;
        for (int i = 1; i < staffs.size(); i++) {
            if (!sameSystem(staffs.get(i - 1), staffs.get(i))) { groups.add(new int[]{first, i - 1}); first = i; }
        }
        groups.add(new int[]{first, staffs.size() - 1});
        return systemExtents(staffs, groups, spacing);
    }

    private static Result empty() { return new Result(new int[0], new int[0], new int[0], new int[0], new int[0]); }

    /** Most common distance between neighbouring thin horizontal strokes, i.e. the staff line spacing. */
    private float estimateSpacing() {
        int maxThickness = Math.max(3, width / 300);
        int maxDistance = Math.max(8, height / 25);
        int[] histogram = new int[maxDistance + 2];
        int samples = 0;
        int step = Math.max(1, width / 300);
        for (int x = width / 10; x < width * 9 / 10; x += step) {
            float previousCenter = -1;
            int runStart = -1;
            for (int y = 0; y <= height; y++) {
                boolean d = y < height && dark[y * width + x];
                if (d && runStart < 0) runStart = y;
                else if (!d && runStart >= 0) {
                    int thickness = y - runStart;
                    float center = (runStart + y - 1) / 2f;
                    if (thickness <= maxThickness) {
                        if (previousCenter >= 0) {
                            int distance = Math.round(center - previousCenter);
                            if (distance >= 3 && distance <= maxDistance) { histogram[distance]++; samples++; }
                        }
                        previousCenter = center;
                    } else previousCenter = -1;
                    runStart = -1;
                }
            }
        }
        if (samples < 50) return 0;
        int best = 0, bestScore = -1;
        for (int d = 3; d <= maxDistance; d++) {
            int score = histogram[d - 1] + 2 * histogram[d] + histogram[d + 1];
            if (score > bestScore) { bestScore = score; best = d; }
        }
        float weighted = histogram[best - 1] * (best - 1f) + histogram[best] * (float) best + histogram[best + 1] * (best + 1f);
        int count = histogram[best - 1] + histogram[best] + histogram[best + 1];
        return count == 0 ? 0 : weighted / count;
    }

    private List<Staff> findStaffs(float spacing) {
        int stripWidth = Math.max(12, Math.round(spacing * 5));
        int strips = width / stripWidth;
        // detections per strip: {strip, top, bottom}
        List<float[]> detections = new ArrayList<>();
        int maxLineThickness = Math.max(Math.max(3, width / 300) + 1, Math.round(spacing * .45f));
        float lineThickness = Math.max(1f, spacing * .15f);
        int[] coverage = new int[height];
        for (int k = 0; k < strips; k++) {
            int x0 = k * stripWidth, x1 = x0 + stripWidth;
            for (int y = 0; y < height; y++) {
                int count = 0, row = y * width, nextRow = y + 1 < height ? row + width : row;
                for (int x = x0; x < x1; x++) if (dark[row + x] || dark[nextRow + x]) count++;
                coverage[y] = count;
            }
            ArrayList<Float> lines = new ArrayList<>();
            int threshold = Math.round(stripWidth * .8f), runStart = -1;
            for (int y = 0; y <= height; y++) {
                boolean hit = y < height && coverage[y] >= threshold;
                if (hit && runStart < 0) runStart = y;
                else if (!hit && runStart >= 0) {
                    // a hit at y covers rows y and y+1, so the stroke ends one row later
                    int thickness = y - runStart;
                    if (thickness <= maxLineThickness) lines.add((runStart + y) / 2f);
                    else if (thickness <= spacing * 1.5f) {
                        // A beam merged with a staff line: the line is at one of the stroke's edges.
                        lines.add(runStart + lineThickness / 2f);
                        lines.add(y - lineThickness / 2f);
                    }
                    runStart = -1;
                }
            }
            for (int i = 0; i < lines.size(); i++) {
                // Pick the fifth line so that the inner lines fit the averaged spacing best.
                float a = lines.get(i);
                int bestEnd = -1, bestInner = 2;
                float bestError = Float.MAX_VALUE;
                for (int e = i + 1; e < lines.size() && lines.get(e) - a <= spacing * 4 * 1.3f; e++) {
                    float d = (lines.get(e) - a) / 4;
                    if (d < spacing * .75f) continue;
                    float tolerance = Math.max(1.5f, d * .2f);
                    int inner = 0;
                    for (int line = 1; line <= 3; line++) if (nearest(lines, a + line * d, tolerance) >= 0) inner++;
                    float error = Math.abs(d - spacing);
                    if (inner > bestInner || (inner == bestInner && error < bestError)) { bestEnd = e; bestInner = inner; bestError = error; }
                }
                if (bestEnd >= 0) {
                    detections.add(new float[]{k, a, lines.get(bestEnd)});
                    i = bestEnd;
                }
            }
        }

        // Chain detections of neighbouring strips into staves.
        List<List<float[]>> chains = new ArrayList<>();
        for (float[] detection : detections) {
            List<float[]> best = null;
            float bestDistance = Float.MAX_VALUE;
            for (List<float[]> chain : chains) {
                float[] last = chain.get(chain.size() - 1);
                float gap = detection[0] - last[0];
                if (gap < 1) continue;
                // Staves are far apart, so a staff may be continued after dense passages; allow ~1° of skew.
                float distance = Math.abs(detection[1] - last[1]);
                if (distance <= spacing * .8f + gap * stripWidth * .02f && distance < bestDistance) { best = chain; bestDistance = distance; }
            }
            if (best == null) { best = new ArrayList<>(); chains.add(best); }
            best.add(detection);
        }

        int minStrips = Math.max(3, Math.round(strips * .15f));
        List<Staff> staffs = new ArrayList<>();
        for (List<float[]> chain : chains) {
            if (chain.size() < minStrips) continue;
            int n = chain.size();
            float[] xs = new float[n], tops = new float[n], heights = new float[n];
            for (int i = 0; i < n; i++) {
                float[] d = chain.get(i);
                xs[i] = (d[0] + .5f) * stripWidth;
                heights[i] = d[2] - d[1];
            }
            // A median of three neighbours suppresses single strips matched one line off.
            for (int i = 0; i < n; i++) {
                float a = chain.get(Math.max(0, i - 1))[1], b = chain.get(i)[1], c = chain.get(Math.min(n - 1, i + 1))[1];
                tops[i] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
            }
            Arrays.sort(heights);
            Staff staff = new Staff(xs, tops, heights[n / 2]);
            int[] start = traceLineEnd(staff, Math.round(chain.get(0)[0] * stripWidth), -1);
            int[] end = traceLineEnd(staff, Math.round((chain.get(n - 1)[0] + 1) * stripWidth) - 1, 1);
            staff.extend(start[0], start[1], end[0], end[1]);
            staffs.add(staff);
        }
        Collections.sort(staffs, (a, b) -> Float.compare(a.topAt(width / 2f), b.topAt(width / 2f)));
        // Ledger lines or beams next to a staff can yield a shifted phantom staff; keep the better supported one.
        for (int i = 1; i < staffs.size(); i++) {
            Staff upper = staffs.get(i - 1), lower = staffs.get(i);
            float x = (Math.max(upper.left, lower.left) + Math.min(upper.right, lower.right)) / 2f;
            if (lower.topAt(x) < upper.bottomAt(x) + spacing * .5f) {
                staffs.remove(upper.strips >= lower.strips ? i : i - 1);
                i--;
            }
        }
        return staffs;
    }

    private static int nearest(List<Float> lines, float target, float tolerance) {
        int best = -1;
        float bestDistance = tolerance;
        for (int i = 0; i < lines.size(); i++) {
            float distance = Math.abs(lines.get(i) - target);
            if (distance <= bestDistance) { bestDistance = distance; best = i; }
        }
        return best;
    }

    /**
     * Follows the staff lines from x in the given direction until fewer than three of the five lines continue,
     * adjusting to lines that drift up or down. Returns the last x and the vertical drift there.
     */
    private int[] traceLineEnd(Staff staff, int x, int direction) {
        int last = x, lastDrift = 0, drift = 0, misses = 0;
        int maxMisses = Math.max(2, Math.round(staff.spacing() * .3f));
        for (int cx = x; cx >= 0 && cx < width; cx += direction) {
            int bestCount = -1, bestDrift = drift;
            for (int candidate : new int[]{drift, drift - 1, drift + 1}) {
                int count = 0;
                for (int line = 0; line < 5; line++) {
                    int y = Math.round(staff.topAt(cx) + line * staff.spacing()) + candidate;
                    if (isDark(cx, y) || isDark(cx, y + 1)) count++;
                }
                if (count > bestCount) { bestCount = count; bestDrift = candidate; }
            }
            if (bestCount >= 3) { last = cx; drift = lastDrift = bestDrift; misses = 0; }
            else if (++misses > maxMisses) break;
        }
        return new int[]{last, lastDrift};
    }

    /**
     * Barlines cross the whole staff and stop at its outer lines unless they continue to a neighbouring staff.
     * The end check keeps stems of beamed notes, which also cross the staff, out of the list.
     */
    private void findBarlines(Staff staff, Staff above, Staff below) {
        ArrayList<Integer> bars = new ArrayList<>();
        int runStart = -1;
        float spacing = staff.spacing(), maxBarWidth = Math.max(3, spacing * .8f);
        for (int x = staff.left; x <= staff.right + 1; x++) {
            boolean full = x <= staff.right && columnFilled(x, Math.round(staff.topAt(x) + spacing * .2f),
                    Math.round(staff.bottomAt(x) - spacing * .2f), .92f);
            if (full && runStart < 0) runStart = x;
            else if (!full && runStart >= 0) {
                int bar = (runStart + x - 1) / 2, limit = Math.round(maxBarWidth) + 2;
                // Beams lying on an outer line make stems look like barlines; they are wide near the edge.
                boolean thin = x - runStart <= maxBarWidth
                        && narrowAt(bar, Math.round(staff.topAt(bar) + spacing * .35f), limit)
                        && narrowAt(bar, Math.round(staff.topAt(bar) - spacing * .45f), limit)
                        && narrowAt(bar, Math.round(staff.bottomAt(bar) - spacing * .35f), limit)
                        && narrowAt(bar, Math.round(staff.bottomAt(bar) + spacing * .45f), limit);
                if (thin && barEndOk(staff, above, bar, true) && barEndOk(staff, below, bar, false)) bars.add(bar);
                runStart = -1;
            }
        }
        staff.bars = new int[bars.size()];
        for (int i = 0; i < bars.size(); i++) staff.bars[i] = bars.get(i);
    }

    private boolean barEndOk(Staff staff, Staff neighbour, int x, boolean upwards) {
        float spacing = staff.spacing();
        int edge = Math.round(upwards ? staff.topAt(x) : staff.bottomAt(x));
        int near = Math.round(spacing * .25f), far = Math.round(spacing * .8f);
        int from = upwards ? edge - far : edge + near, to = upwards ? edge - near : edge + far;
        if (!lineFilled(x, from, to, .5f)) return true;
        if (neighbour == null) return false;
        int neighbourEdge = Math.round(upwards ? neighbour.bottomAt(x) : neighbour.topAt(x));
        return lineFilled(x, Math.min(edge, neighbourEdge), Math.max(edge, neighbourEdge), .9f);
    }

    /** True when row y has no ink at x or only a horizontal run of at most maxWidth pixels through x. */
    private boolean narrowAt(int x, int y, int maxWidth) {
        int start = -1;
        for (int cx = x - 1; cx <= x + 1; cx++) if (isDark(cx, y)) { start = cx; break; }
        if (start < 0) return true;
        int left = start, right = start;
        while (left - 1 >= 0 && isDark(left - 1, y) && right - left < maxWidth) left--;
        while (right + 1 < width && isDark(right + 1, y) && right - left < maxWidth) right++;
        return right - left < maxWidth;
    }

    /** Like columnFilled, but tolerant to the exact position of a thin vertical line centred at x. */
    private boolean lineFilled(int x, int fromY, int toY, float minFraction) {
        if (toY < fromY) return false;
        int filled = 0;
        for (int y = fromY; y <= toY; y++) if (isDark(x - 1, y) || isDark(x, y) || isDark(x + 1, y)) filled++;
        return filled >= (toY - fromY + 1) * minFraction;
    }

    private boolean columnFilled(int x, int fromY, int toY, float minFraction) {
        if (toY < fromY) return false;
        int filled = 0;
        for (int y = fromY; y <= toY; y++) if (isDark(x, y) || isDark(x + 1, y)) filled++;
        return filled >= (toY - fromY + 1) * minFraction;
    }

    /** Staves of one system are joined by a barline through the gap or by the system barline/bracket at the left. */
    private boolean sameSystem(Staff upper, Staff lower) {
        float spacing = Math.max(upper.spacing(), lower.spacing());
        float tolerance = Math.max(3, spacing * .5f);
        for (int a : upper.bars) {
            for (int b : lower.bars) {
                if (Math.abs(a - b) > tolerance) continue;
                int x = (a + b) / 2;
                if (lineFilled(x, Math.round(upper.bottomAt(x)), Math.round(lower.topAt(x)), .95f)) return true;
            }
        }
        return connectedAtStart(upper, lower, spacing);
    }

    /** True when every row between the staves has ink close to their left edge (system barline, bracket or brace). */
    private boolean connectedAtStart(Staff upper, Staff lower, float spacing) {
        int edge = Math.min(upper.left, lower.left);
        int from = Math.max(0, Math.round(edge - spacing * 3));
        int to = Math.min(width - 1, Math.round(Math.max(upper.left, lower.left) + spacing));
        int top = Math.round(upper.bottomAt(edge)), bottom = Math.round(lower.topAt(edge));
        if (bottom <= top) return true;
        int filled = 0;
        for (int y = top; y <= bottom; y++) {
            for (int x = from; x <= to; x++) if (isDark(x, y)) { filled++; break; }
        }
        return filled >= (bottom - top + 1) * .95f;
    }

    private Result systemExtents(List<Staff> staffs, List<int[]> groups, float spacing) {
        int contentLeft = width, contentRight = 0;
        for (Staff staff : staffs) { contentLeft = Math.min(contentLeft, staff.left); contentRight = Math.max(contentRight, staff.right); }
        contentLeft = Math.max(0, Math.round(contentLeft - spacing * 3));
        contentRight = Math.min(width - 1, Math.round(contentRight + spacing));
        int[] ink = new int[height];
        for (int y = 0; y < height; y++) {
            int count = 0, row = y * width;
            for (int x = contentLeft; x <= contentRight; x++) if (dark[row + x]) count++;
            ink[y] = count;
        }
        int noise = Math.max(1, width / 600);
        int systems = groups.size();
        int[] staffTop = new int[systems], staffBottom = new int[systems], staffCount = new int[systems];
        for (int i = 0; i < systems; i++) {
            int[] group = groups.get(i);
            staffTop[i] = staffs.get(group[0]).minTop();
            staffBottom[i] = staffs.get(group[1]).maxBottom();
            staffCount[i] = group[1] - group[0] + 1;
        }
        // Between two systems the dividing row lies in the longest blank run.
        int[] dividers = new int[systems + 1];
        int pageMargin = Math.round(spacing * 7);
        dividers[0] = Math.max(0, staffTop[0] - pageMargin);
        dividers[systems] = Math.min(height - 1, staffBottom[systems - 1] + pageMargin);
        for (int i = 1; i < systems; i++) dividers[i] = blankDivider(ink, staffBottom[i - 1], staffTop[i], noise);

        int minBlank = Math.round(spacing * 2), margin = Math.max(2, Math.round(spacing * .4f));
        int[] top = new int[systems], bottom = new int[systems];
        for (int i = 0; i < systems; i++) {
            int lastInk = staffTop[i];
            for (int y = staffTop[i] - 1; y > dividers[i]; y--) {
                if (ink[y] > noise) lastInk = y;
                else if (lastInk - y >= minBlank) break;
            }
            top[i] = Math.max(dividers[i], lastInk - margin);
            lastInk = staffBottom[i];
            for (int y = staffBottom[i] + 1; y < dividers[i + 1]; y++) {
                if (ink[y] > noise) lastInk = y;
                else if (y - lastInk >= minBlank) break;
            }
            bottom[i] = Math.min(dividers[i + 1], lastInk + margin);
        }
        int[] lineTop = new int[staffs.size()], lineBottom = new int[staffs.size()];
        for (int i = 0; i < staffs.size(); i++) { lineTop[i] = staffs.get(i).minTop(); lineBottom[i] = staffs.get(i).maxBottom(); }
        return new Result(top, bottom, staffCount, lineTop, lineBottom);
    }

    private static int blankDivider(int[] ink, int from, int to, int noise) {
        int bestStart = -1, bestLength = 0, runStart = -1, minRow = (from + to) / 2;
        for (int y = from + 1; y <= to; y++) {
            boolean blank = y < to && ink[y] <= noise;
            if (blank && runStart < 0) runStart = y;
            else if (!blank && runStart >= 0) {
                if (y - runStart > bestLength) { bestLength = y - runStart; bestStart = runStart; }
                runStart = -1;
            }
            if (y < to && ink[y] < ink[minRow]) minRow = y;
        }
        return bestStart >= 0 ? bestStart + bestLength / 2 : minRow;
    }
}
