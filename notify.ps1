param([string]$MessageBase64)
$ErrorActionPreference = 'Stop'
$message = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($MessageBase64))
$appId = 'Pulso.CotasCodex'
$key = 'HKCU:\Software\Classes\AppUserModelId\Pulso.CotasCodex'
New-Item -Path $key -Force | Out-Null
New-ItemProperty -Path $key -Name DisplayName -Value 'Pulso - Cotas do Codex' -PropertyType String -Force | Out-Null
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$safe = [Security.SecurityElement]::Escape($message)
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml("<toast><visual><binding template='ToastGeneric'><text>Pulso · Cotas do Codex</text><text>$safe</text></binding></visual></toast>")
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
