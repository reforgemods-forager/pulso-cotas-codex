Option Explicit
Dim shell, fso, folder, command, i
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
command = "node.exe """ & folder & "\supervisor.mjs"""
For i = 0 To WScript.Arguments.Count - 1
  If WScript.Arguments(i) = "--background" Then command = command & " --background"
Next
shell.Run command, 0, False
