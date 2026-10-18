package de.mannimanfred.notenleser;

import android.content.Context;
import android.graphics.ImageFormat;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCaptureSession;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraDevice;
import android.hardware.camera2.CameraManager;
import android.hardware.camera2.CaptureRequest;
import android.hardware.camera2.params.StreamConfigurationMap;
import android.media.Image;
import android.media.ImageReader;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Size;

import java.nio.ByteBuffer;
import java.util.Collections;

/**
 * Recognises a hand swiped sideways in front of the front camera.
 * Each frame is reduced to a coarse brightness grid; while cells keep changing, the centroid of the
 * change is tracked, and a mostly horizontal travel across the picture counts as a swipe. With the
 * fine sensitivity a small finger movement close to the camera is enough.
 * Frames are only analysed in memory and never stored.
 */
final class CameraGestureDetector {

    interface Listener {
        /** Called on the main thread: 1 when the hand moved to the player's left (like turning a page), -1 to the right. */
        void onSwipe(int direction);
        void onCameraError(String message);
        /** Called on the main thread for every analysed frame while debugging is on. */
        void onDebugFrame(DebugFrame frame);
    }

    /** What the detector saw in one frame, already turned to match the screen as the player sees it. */
    static final class DebugFrame {
        /** Grid size in screen orientation. */
        final int width, height;
        /** Brightness (0–255) and change against the previous frame per cell, row by row. */
        final float[] luma, change;
        /** Share of changing cells and the share needed to count as motion. */
        final float share, minMoving;
        final boolean tracking;
        /** Start and current motion centroid as shares of the screen-oriented picture; NaN without motion. */
        final float startX, startY, x, y;
        /** Horizontal travel since the start (negative = to the left) and the travel needed for a swipe. */
        final float travel, minTravel;
        /** Swipe recognised in this frame (see {@link Listener#onSwipe}), 0 otherwise. */
        final int swipe;

        DebugFrame(int width, int height, float[] luma, float[] change, float share, float minMoving, boolean tracking,
                   float startX, float startY, float x, float y, float travel, float minTravel, int swipe) {
            this.width = width; this.height = height; this.luma = luma; this.change = change;
            this.share = share; this.minMoving = minMoving; this.tracking = tracking;
            this.startX = startX; this.startY = startY; this.x = x; this.y = y;
            this.travel = travel; this.minTravel = minTravel; this.swipe = swipe;
        }
    }

    /** How far the finger or hand has to travel. */
    static final int SENSITIVITY_FINE = 0, SENSITIVITY_MEDIUM = 1, SENSITIVITY_COARSE = 2;

    private static final int GRID_W = 32, GRID_H = 24;
    /** Brightness change of a grid cell (0–255) that counts as motion. */
    static final float CELL_THRESHOLD = 14f;
    /** Above this share of changing cells the whole picture changed (light, shaking) rather than a hand. */
    private static final float MAX_MOVING = .75f;
    private static final long MAX_SWIPE_MS = 1200, COOLDOWN_MS = 900;
    private static final int MIN_ACTIVE_FRAMES = 3, QUIET_FRAMES_TO_END = 3;

    private final Context context;
    private final Listener listener;
    private final HandlerThread thread = new HandlerThread("notenleser-camera-gestures");
    private final Handler handler;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private volatile boolean wanted;
    private volatile int displayRotation;
    private volatile boolean debug;
    /** Share of changing cells needed for motion; a close finger covers less of the picture than a hand. */
    private volatile float minMoving = .01f;
    /** Horizontal travel of the motion centroid, as a share of the picture width, that makes a swipe. */
    private volatile float minTravel = .15f;

    // Everything below is only touched on the camera thread.
    private CameraDevice camera;
    private CameraCaptureSession session;
    private ImageReader reader;
    private boolean opening;
    private int sensorOrientation;
    private float[] previousGrid, currentGrid = new float[GRID_W * GRID_H];
    private boolean tracking;
    private float startX, startY, lastX, lastY;
    private long startTime, cooldownUntil;
    private int activeFrames, quietFrames;

    CameraGestureDetector(Context context, Listener listener) {
        this.context = context.getApplicationContext();
        this.listener = listener;
        thread.start();
        handler = new Handler(thread.getLooper());
    }

    /** Starts watching; the display rotation in degrees maps camera motion to screen directions. */
    void start(int displayRotationDegrees) {
        displayRotation = displayRotationDegrees;
        wanted = true;
        handler.post(this::openCamera);
    }

    void setDisplayRotation(int displayRotationDegrees) { displayRotation = displayRotationDegrees; }

    void setSensitivity(int sensitivity) {
        switch (sensitivity) {
            case SENSITIVITY_COARSE: minMoving = .03f; minTravel = .35f; break;
            case SENSITIVITY_MEDIUM: minMoving = .02f; minTravel = .25f; break;
            default: minMoving = .01f; minTravel = .15f; break;
        }
    }

    void setDebug(boolean enabled) { debug = enabled; }

    void stop() {
        wanted = false;
        handler.post(this::closeCamera);
    }

    /** Releases the camera and the worker thread; the detector cannot be started again. */
    void shutdown() {
        stop();
        thread.quitSafely();
    }

    private void openCamera() {
        if (!wanted || camera != null || opening) return;
        CameraManager manager = (CameraManager) context.getSystemService(Context.CAMERA_SERVICE);
        try {
            String frontId = null;
            CameraCharacteristics front = null;
            for (String id : manager.getCameraIdList()) {
                CameraCharacteristics characteristics = manager.getCameraCharacteristics(id);
                Integer facing = characteristics.get(CameraCharacteristics.LENS_FACING);
                if (facing != null && facing == CameraCharacteristics.LENS_FACING_FRONT) { frontId = id; front = characteristics; break; }
            }
            if (frontId == null) { reportError("Keine Frontkamera gefunden"); return; }
            Integer orientation = front.get(CameraCharacteristics.SENSOR_ORIENTATION);
            sensorOrientation = orientation == null ? 270 : orientation;
            StreamConfigurationMap map = front.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP);
            Size size = smallestSize(map == null ? null : map.getOutputSizes(ImageFormat.YUV_420_888));
            if (size == null) { reportError("Die Frontkamera liefert kein passendes Bildformat"); return; }
            reader = ImageReader.newInstance(size.getWidth(), size.getHeight(), ImageFormat.YUV_420_888, 2);
            reader.setOnImageAvailableListener(this::onImage, handler);
            opening = true;
            manager.openCamera(frontId, new CameraDevice.StateCallback() {
                @Override public void onOpened(CameraDevice device) {
                    opening = false;
                    if (!wanted) { device.close(); closeCamera(); return; }
                    camera = device;
                    startSession(device);
                }

                @Override public void onDisconnected(CameraDevice device) {
                    opening = false;
                    device.close();
                    if (camera == device) closeCamera();
                }

                @Override public void onError(CameraDevice device, int error) {
                    opening = false;
                    device.close();
                    if (camera == device || camera == null) closeCamera();
                    if (wanted) reportError(error == ERROR_CAMERA_IN_USE || error == ERROR_MAX_CAMERAS_IN_USE
                            ? "Die Frontkamera wird gerade von einer anderen App benutzt" : "Die Frontkamera ist ausgefallen");
                }
            }, handler);
        } catch (CameraAccessException | SecurityException | IllegalArgumentException e) {
            opening = false;
            closeCamera();
            reportError("Frontkamera nicht verfügbar");
        }
    }

    /** The smallest stream of at least 160×120 keeps the analysis cheap while hands stay recognisable. */
    private static Size smallestSize(Size[] sizes) {
        if (sizes == null || sizes.length == 0) return null;
        Size best = null;
        for (Size size : sizes) {
            if (size.getWidth() < 160 || size.getHeight() < 120) continue;
            if (best == null || (long) size.getWidth() * size.getHeight() < (long) best.getWidth() * best.getHeight()) best = size;
        }
        if (best != null) return best;
        for (Size size : sizes)
            if (best == null || (long) size.getWidth() * size.getHeight() > (long) best.getWidth() * best.getHeight()) best = size;
        return best;
    }

    @SuppressWarnings("deprecation")
    private void startSession(CameraDevice device) {
        try {
            device.createCaptureSession(Collections.singletonList(reader.getSurface()), new CameraCaptureSession.StateCallback() {
                @Override public void onConfigured(CameraCaptureSession configured) {
                    if (camera != device) { configured.close(); return; }
                    session = configured;
                    try {
                        CaptureRequest.Builder request = device.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW);
                        request.addTarget(reader.getSurface());
                        configured.setRepeatingRequest(request.build(), null, handler);
                    } catch (CameraAccessException | IllegalStateException e) {
                        closeCamera();
                        if (wanted) reportError("Frontkamera konnte nicht gestartet werden");
                    }
                }

                @Override public void onConfigureFailed(CameraCaptureSession failed) {
                    closeCamera();
                    if (wanted) reportError("Frontkamera konnte nicht gestartet werden");
                }
            }, handler);
        } catch (CameraAccessException | IllegalStateException e) {
            closeCamera();
            if (wanted) reportError("Frontkamera konnte nicht gestartet werden");
        }
    }

    private void closeCamera() {
        if (session != null) { try { session.close(); } catch (IllegalStateException ignored) { } session = null; }
        if (camera != null) { camera.close(); camera = null; }
        if (reader != null) { reader.close(); reader = null; }
        previousGrid = null; tracking = false;
    }

    private void onImage(ImageReader source) {
        Image image;
        try { image = source.acquireLatestImage(); } catch (IllegalStateException e) { return; }
        if (image == null) return;
        try { analyse(image); } finally { image.close(); }
    }

    private void analyse(Image image) {
        Image.Plane luma = image.getPlanes()[0];
        ByteBuffer buffer = luma.getBuffer();
        int rowStride = luma.getRowStride(), pixelStride = luma.getPixelStride();
        int width = image.getWidth(), height = image.getHeight();
        float frameSum = 0f;
        for (int gy = 0; gy < GRID_H; gy++) {
            int y0 = gy * height / GRID_H, y1 = (gy + 1) * height / GRID_H;
            for (int gx = 0; gx < GRID_W; gx++) {
                int x0 = gx * width / GRID_W, x1 = (gx + 1) * width / GRID_W;
                int sum = 0, count = 0;
                for (int y = y0; y < y1; y += 2) {
                    int row = y * rowStride;
                    for (int x = x0; x < x1; x += 2) { sum += buffer.get(row + x * pixelStride) & 0xff; count++; }
                }
                float value = count == 0 ? 0f : sum / (float) count;
                currentGrid[gy * GRID_W + gx] = value;
                frameSum += value;
            }
        }
        boolean debugging = debug;
        float[] rawLuma = debugging ? currentGrid.clone() : null;
        // Comparing cells against the frame mean ignores exposure changes that brighten everything at once.
        float frameMean = frameSum / currentGrid.length;
        for (int i = 0; i < currentGrid.length; i++) currentGrid[i] -= frameMean;
        float[] previous = previousGrid;
        previousGrid = currentGrid;
        currentGrid = previous != null ? previous : new float[GRID_W * GRID_H];
        if (previous == null) return;

        float[] changes = debugging ? new float[GRID_W * GRID_H] : null;
        int moving = 0;
        float weight = 0f, sumX = 0f, sumY = 0f;
        for (int gy = 0; gy < GRID_H; gy++) {
            for (int gx = 0; gx < GRID_W; gx++) {
                float change = Math.abs(previousGrid[gy * GRID_W + gx] - previous[gy * GRID_W + gx]);
                if (changes != null) changes[gy * GRID_W + gx] = change;
                if (change < CELL_THRESHOLD) continue;
                moving++; weight += change;
                sumX += change * (gx + .5f) / GRID_W; sumY += change * (gy + .5f) / GRID_H;
            }
        }
        float share = moving / (float) (GRID_W * GRID_H);
        float x = moving == 0 ? Float.NaN : sumX / weight, y = moving == 0 ? Float.NaN : sumY / weight;
        int swipe = track(share, x, y);
        if (debugging) postDebugFrame(rawLuma, changes, share, x, y, swipe);
    }

    /** Follows the motion centroid and returns the recognised swipe direction, or 0. */
    private int track(float share, float x, float y) {
        long now = SystemClock.uptimeMillis();
        if (now < cooldownUntil) { tracking = false; return 0; }
        if (share < minMoving || share > MAX_MOVING) {
            if (tracking && ++quietFrames >= QUIET_FRAMES_TO_END) tracking = false;
            return 0;
        }
        if (!tracking || now - startTime > MAX_SWIPE_MS) {
            tracking = true; startX = x; startY = y; startTime = now; activeFrames = 0;
        }
        lastX = x; lastY = y; activeFrames++; quietFrames = 0;
        if (activeFrames < MIN_ACTIVE_FRAMES) return 0;
        float[] travel = toScreen(lastX - startX, lastY - startY);
        if (Math.abs(travel[0]) < minTravel || Math.abs(travel[0]) <= Math.abs(travel[1]) * 1.5f) return 0;
        tracking = false;
        cooldownUntil = now + COOLDOWN_MS;
        int direction = travel[0] < 0 ? 1 : -1;
        mainHandler.post(() -> { if (wanted) listener.onSwipe(direction); });
        return direction;
    }

    private void postDebugFrame(float[] rawLuma, float[] changes, float share, float x, float y, int swipe) {
        boolean turned = rotation() == 90 || rotation() == 270;
        int width = turned ? GRID_H : GRID_W, height = turned ? GRID_W : GRID_H;
        float[] luma = new float[width * height], change = new float[width * height];
        for (int gy = 0; gy < GRID_H; gy++) {
            for (int gx = 0; gx < GRID_W; gx++) {
                float[] point = toScreenPoint((gx + .5f) / GRID_W, (gy + .5f) / GRID_H);
                int sx = Math.min(width - 1, (int) (point[0] * width)), sy = Math.min(height - 1, (int) (point[1] * height));
                luma[sy * width + sx] = rawLuma[gy * GRID_W + gx];
                change[sy * width + sx] = changes[gy * GRID_W + gx];
            }
        }
        float[] current = Float.isNaN(x) ? new float[]{Float.NaN, Float.NaN} : toScreenPoint(x, y);
        float[] start = tracking || swipe != 0 ? toScreenPoint(startX, startY) : new float[]{Float.NaN, Float.NaN};
        float travel = tracking || swipe != 0 ? toScreen(lastX - startX, lastY - startY)[0] : 0f;
        DebugFrame frame = new DebugFrame(width, height, luma, change, share, minMoving, tracking,
                start[0], start[1], current[0], current[1], travel, minTravel, swipe);
        mainHandler.post(() -> { if (wanted && debug) listener.onDebugFrame(frame); });
    }

    /** Clockwise rotation from the mirrored sensor picture to the screen. */
    private int rotation() { return (360 - (sensorOrientation + displayRotation) % 360) % 360; }

    /**
     * Maps a motion in sensor coordinates to the screen as the player sees it, like in a mirror:
     * the front camera picture is mirrored first and then rotated clockwise to match the display.
     */
    private float[] toScreen(float dx, float dy) {
        float x = -dx, y = dy;
        switch (rotation()) {
            case 90: return new float[]{-y, x};
            case 180: return new float[]{-x, -y};
            case 270: return new float[]{y, -x};
            default: return new float[]{x, y};
        }
    }

    /** Like {@link #toScreen}, but for a position given as shares of the sensor picture. */
    private float[] toScreenPoint(float u, float v) {
        float x = 1f - u, y = v;
        switch (rotation()) {
            case 90: return new float[]{1f - y, x};
            case 180: return new float[]{1f - x, 1f - y};
            case 270: return new float[]{y, 1f - x};
            default: return new float[]{x, y};
        }
    }

    private void reportError(String message) {
        mainHandler.post(() -> { if (wanted) listener.onCameraError(message); });
    }
}
