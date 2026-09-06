Set fso = CreateObject("Scripting.FileSystemObject")
strPath = fso.GetAbsolutePathName(".")
strExe = fso.BuildPath(strPath, "月薪喵.exe")
Set shell = CreateObject("WScript.Shell")
shell.Run """" & strExe & """", 1, False
