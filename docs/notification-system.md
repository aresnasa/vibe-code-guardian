# Notification System

Vibe Code Guardian includes a smart notification system that prevents spam during rapid AI editing sessions while keeping you informed about important events.

---

## Configuration

All settings live under `vibeCodeGuardian.*` in VS Code settings.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `showNotifications` | `boolean` | `true` | Master switch for all notifications |
| `notificationLevel` | `enum` | `"milestone"` | Which events trigger a notification |
| `notificationThrottle` | `number` | `5000` | Minimum ms between similar notifications (1 000–60 000) |
| `maxNotificationWindows` | `number` | `3` | Max notification popups before suppression (1–10) |

### Notification Levels

| Level | Shows |
|-------|-------|
| `all` | Every checkpoint event (subject to throttling) |
| `milestone` | Manual checkpoints and session start/end only (**recommended**) |
| `none` | Silent — only critical errors are shown |

---

## How Throttling Works

The `SmartNotificationManager` class applies three filters before displaying a notification:

1. **Time gate** — a new notification is suppressed if the previous one arrived less than `notificationThrottle` ms ago.
2. **Similarity check** — messages that share > 50 % of their words with a recent notification are silently dropped.
3. **Window cap** — once `maxNotificationWindows` popups are on screen, additional notifications are held until one is dismissed.

Different severity levels have different behavior:

| Severity | Throttle | Similarity filter | Always shown |
|----------|----------|-------------------|--------------|
| **Info** | Full (default 5 s) | Yes | No |
| **Warning** | Reduced (2 s) | Relaxed | No |
| **Error** | None | None | **Yes** |

Errors always bypass all filters.

---

## Presets

### Default (balanced)

```jsonc
{
  "vibeCodeGuardian.notificationLevel": "milestone",
  "vibeCodeGuardian.notificationThrottle": 5000,
  "vibeCodeGuardian.maxNotificationWindows": 3
}
```

Only manual checkpoints and session events are shown, with a 5-second cooldown between similar messages.

### Strict anti-spam

```jsonc
{
  "vibeCodeGuardian.notificationLevel": "all",
  "vibeCodeGuardian.notificationThrottle": 10000,
  "vibeCodeGuardian.maxNotificationWindows": 2
}
```

All events fire, but with a 10-second cooldown and at most 2 popups at once.

### Silent mode

```jsonc
{
  "vibeCodeGuardian.notificationLevel": "none"
}
```

No notifications at all — only fatal errors.

---

## Troubleshooting

### Too few notifications

1. Set `notificationLevel` to `"all"`.
2. Lower `notificationThrottle` (minimum `1000`).
3. Open **Output → Vibe Code Guardian** and look for `🔇` lines — these are throttled messages.

### Too many notifications

1. Raise `notificationThrottle` (e.g. `15000`).
2. Lower `maxNotificationWindows` to `1` or `2`.
3. Switch `notificationLevel` to `"milestone"` or `"none"`.

### Performance

The notification manager is lightweight:

- Keeps only the last 10 messages in memory for similarity comparison.
- Similarity check is O(n) over word sets — negligible CPU cost.
- No background timers; filtering runs synchronously on each notification call.