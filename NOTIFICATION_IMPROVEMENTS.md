# Notification System Improvements

## Overview

The Vibe Code Guardian extension now features an intelligent notification system that prevents notification spam and provides better user control over when and how notifications are displayed.

## Key Improvements

### 1. Smart Notification Throttling

**Problem**: Previously, the extension showed notifications for every single AI-detected change, which could create spam during rapid AI editing sessions.

**Solution**: Implemented intelligent throttling that prevents similar notifications from appearing too frequently.

- **Default throttle**: 5 seconds between similar notifications
- **Configurable**: Users can adjust `notificationThrottle` setting (1000ms to 60000ms)
- **Smart filtering**: Skips notifications that are >50% similar to recent ones

### 2. Multi-Window Management

**Problem**: Multiple notification windows could accumulate on screen during rapid changes.

**Solution**: Intelligent window management that tracks and manages notification history.

- **Maximum windows**: Configurable limit (default: 3, range: 1-10)
- **History tracking**: Keeps last 10 notifications for comparison
- **Auto-dismiss suggestion**: Shows warnings when too many windows are open

### 3. User-Configurable Settings

#### New Settings

```json
{
  "vibeCodeGuardian.notificationThrottle": {
    "type": "number",
    "default": 5000,
    "minimum": 1000,
    "maximum": 60000,
    "description": "Minimum time between similar notifications in milliseconds (default: 5000ms = 5 seconds)"
  },
  "vibeCodeGuardian.maxNotificationWindows": {
    "type": "number",
    "default": 3,
    "minimum": 1,
    "maximum": 10,
    "description": "Maximum number of notification windows to show before suggesting to dismiss (default: 3)"
  }
}
```

### 4. Notification Level Control

The existing `notificationLevel` setting still works with the new system:

- **`all`**: Show all notifications (subject to throttling)
- **`milestone`**: Show only manual checkpoints and session events (recommended)
- **`none`**: Silent mode, no notifications

## Technical Implementation

### SmartNotificationManager Class

The new `SmartNotificationManager` class provides:

- **Time-based throttling**: Prevents notifications too close in time
- **Content-based filtering**: Skips similar messages using word comparison
- **History management**: Tracks recent notifications for smart filtering
- **Window management**: Monitors notification window count

### Notification Behavior

#### Information Messages
- Apply throttling (5 seconds default)
- Check message similarity (>50% similarity threshold)
- Support dismissible notifications
- Maintain notification history

#### Warning Messages
- Shorter throttle time (2 seconds)
- Less strict filtering
- Important warnings always show through

#### Error Messages
- No throttling (errors should always be visible)
- Direct display bypassing all filters

## Usage Examples

### Default Configuration
```json
{
  "vibeCodeGuardian.notificationLevel": "milestone",
  "vibeCodeGuardian.notificationThrottle": 5000,
  "vibeCodeGuardian.maxNotificationWindows": 3
}
```

Result: Only manual checkpoints and session events shown, AI notifications throttled to 5-second intervals.

### Strict Spam Prevention
```json
{
  "vibeCodeGuardian.notificationLevel": "all",
  "vibeCodeGuardian.notificationThrottle": 10000,
  "vibeCodeGuardian.maxNotificationWindows": 2
}
```

Result: All notifications shown but with 10-second minimum interval and maximum 2 windows open at once.

### Minimal Notifications
```json
{
  "vibeCodeGuardian.notificationLevel": "none",
  "vibeCodeGuardian.notificationThrottle": 0
  "vibeCodeGuardian.maxNotificationWindows": 1
}
```

Result: Silent mode, only critical error messages shown.

## Benefits

1. **Reduced Notification Spam**: AI-triggered checkpoints during rapid editing won't flood the UI
2. **Better User Experience**: Users can focus on coding without constant interruptions
3. **Configurable Behavior**: Users can tune notification frequency to their preference
4. **Smart Filtering**: Similar messages are intelligently grouped or skipped
5. **Multi-Window Control**: Prevents screen clutter during intense coding sessions

## Migration Notes

- Existing settings remain compatible
- New settings use sensible defaults
- Notification behavior is backward compatible
- Users can gradually adopt new features

## Troubleshooting

### Too Few Notifications
If notifications are being suppressed when you expect them:
1. Check `notificationLevel` setting (try `'all'` or `'milestone'`)
2. Reduce `notificationThrottle` value (minimum: 1000ms)
3. Check console logs for throttled messages (search for `🔇`)

### Too Many Notifications
If you're still seeing too many notifications:
1. Increase `notificationThrottle` value
2. Decrease `maxNotificationWindows` value (minimum: 1)
3. Check if multiple AI tools are active simultaneously

### Performance Considerations

The notification system uses:
- Minimal memory overhead (keeps only last 10 messages in history)
- Fast similarity checking (O(n) comparison against history)
- Low CPU overhead (simple string operations)

## Future Enhancements

Potential improvements for future versions:
- Notification grouping/batching
- Custom notification sounds
- Notification persistence across sessions
- Per-source notification settings
- Desktop notification integration
