; 设置默认安装路径
!macro preInit
  StrCpy $INSTDIR "$PROGRAMFILES64\OpenDesktopPet"
!macroend

; 安装前自动关闭正在运行的程序（避免弹出"请手动关闭"提示）
!macro customInstallMode
  nsExec::ExecToLog 'taskkill /F /IM "OpenDesktopPet.exe" /T'
  Sleep 1000
!macroend

; 用户通过 Browse 选择目录后，若末尾不是 OpenDesktopPet 则自动追加
Function .onVerifyInstDir
  ; 取末尾 15 个字符，判断是否已含应用名
  StrCpy $R0 $INSTDIR "" -15
  StrCmp $R0 "OpenDesktopPet" done

  ; 检查末尾字符是否为反斜杠（如 D:\）
  StrCpy $R1 $INSTDIR "" -1
  StrCmp $R1 "\" 0 noSlash
    StrCpy $R2 "OpenDesktopPet"
    StrCpy $INSTDIR "$INSTDIR$R2"
    Goto done
  noSlash:
    StrCpy $R2 "\OpenDesktopPet"
    StrCpy $INSTDIR "$INSTDIR$R2"
  done:
FunctionEnd

; 安装完成后检测并安装 VC++ 2015-2022 运行库
!macro customInstall
  ; 检测 VC++ 2015-2022 x64 是否已安装
  ; 注册表路径：VC++ Redistributable 会写入此键
  ReadRegDWORD $R0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X64" "Installed"
  IntCmp $R0 1 vcRedistOk vcRedistMissing vcRedistMissing

  vcRedistMissing:
    MessageBox MB_YESNO|MB_ICONINFORMATION \
      "OpenDesktopPet requires Microsoft Visual C++ 2015-2022 Redistributable (x64).$\r$\n$\r$\nIt is not installed on your system. Would you like to download and install it now?$\r$\n$\r$\n(Recommended: Click Yes)" \
      IDNO vcRedistSkip

    ; 下载 VC++ Redistributable
    DetailPrint "Downloading Visual C++ 2015-2022 Redistributable..."
    NSISdl::download \
      "https://aka.ms/vs/17/release/vc_redist.x64.exe" \
      "$TEMP\vc_redist.x64.exe"
    Pop $R1
    StrCmp $R1 "success" vcRedistDownloaded

    ; 下载失败提示
    MessageBox MB_OK|MB_ICONEXCLAMATION \
      "Download failed. Please install Visual C++ 2015-2022 Redistributable manually:$\r$\nhttps://aka.ms/vs/17/release/vc_redist.x64.exe"
    Goto vcRedistSkip

  vcRedistDownloaded:
    DetailPrint "Installing Visual C++ 2015-2022 Redistributable..."
    ExecWait '"$TEMP\vc_redist.x64.exe" /install /quiet /norestart' $R2
    Delete "$TEMP\vc_redist.x64.exe"
    IntCmp $R2 0 vcRedistOk
    ; 返回码非0也继续（可能已是最新版）

  vcRedistSkip:
  vcRedistOk:
!macroend
