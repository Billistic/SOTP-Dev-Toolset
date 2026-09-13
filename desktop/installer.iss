; Inno Setup script for SOTP Dev Env.  Compiled by desktop/build.py:
;   ISCC /DAppVersion=2.0.0 /DSourceDir=<pyinstaller output> /O<dist> [/DSign /Ssotp="powershell ... sign.ps1 $f"] installer.iss

#ifndef AppVersion
  #define AppVersion "2.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\SOTP Dev Env"
#endif

[Setup]
AppId={{7E1F3A9C-5B2D-4C7E-9A61-0D5E1F2A3B4C}
AppName=SOTP Dev Env
AppVersion={#AppVersion}
AppVerName=SOTP Dev Env {#AppVersion}
AppPublisher=Sins of the Prophets
AppPublisherURL=https://github.com/Billistic/SOTP-Dev-Toolset
AppUpdatesURL=https://github.com/Billistic/SOTP-Dev-Toolset/releases
VersionInfoVersion={#AppVersion}
DefaultDirName={autopf}\SOTP Dev Env
DefaultGroupName=SOTP Dev Env
UninstallDisplayIcon={app}\SOTP Dev Env.exe
OutputBaseFilename=SOTP-Dev-Env-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
; Inno Setup 6.6+: built-in dark style (forced, to match the app), system title bar kept.
; Branding: tall panel on the welcome / finish pages and the small banner image of the inner pages,
; rendered from brand/emblem.svg by make_installer_art.py (one bitmap per DPI step, Inno picks the best).
WizardStyle=modern dark
WizardBackColor=#1a1a1a
WizardImageBackColor=#0f0f0f
WizardImageFile=installer\wizard-*.bmp
WizardSmallImageFile=installer\small-*.bmp
WizardSizePercent=105
DisableWelcomePage=no
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesInstallIn64BitMode=x64compatible
SetupIconFile=icon.ico
; in-app updates run this installer silently while the app is still open: close it, install, relaunch
CloseApplications=force
RestartApplications=no
#ifdef Sign
SignTool=sotp
SignedUninstaller=yes
#endif

[Messages]
WelcomeLabel1=Welcome to SOTP Dev Env
WelcomeLabel2=This will install SOTP Dev Env {#AppVersion} - the Sins of the Prophets modding environment: entity, research, string and asset editing with link checking and balance analytics.%n%nYour project database and settings live in %LOCALAPPDATA%\SOTP Dev Env and survive updates and reinstalls.
FinishedHeadingLabel=SOTP Dev Env is ready
FinishedLabelNoIcons=Setup has finished installing SOTP Dev Env.
FinishedLabel=Setup has finished installing SOTP Dev Env. Point it at the mod folder (the one holding GameInfo\ and entity.manifest) from Project settings the first time it opens.
BeveledLabel=Sins of the Prophets

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Shortcuts:"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\SOTP Dev Env"; Filename: "{app}\SOTP Dev Env.exe"
Name: "{group}\Uninstall SOTP Dev Env"; Filename: "{uninstallexe}"
Name: "{autodesktop}\SOTP Dev Env"; Filename: "{app}\SOTP Dev Env.exe"; Tasks: desktopicon

[Run]
; interactive install: offer to launch
Filename: "{app}\SOTP Dev Env.exe"; Description: "Launch SOTP Dev Env"; Flags: nowait postinstall skipifsilent
; silent self-update (/UPDATE=1): always relaunch so the user lands back in the app
Filename: "{app}\SOTP Dev Env.exe"; Flags: nowait runasoriginaluser; Check: IsUpdate

; user data (database, .env, logs) stays in %LOCALAPPDATA%\SOTP Dev Env on uninstall so a reinstall keeps the project

[Code]
function IsUpdate: Boolean;
begin
  Result := ExpandConstant('{param:UPDATE|0}') = '1';
end;
