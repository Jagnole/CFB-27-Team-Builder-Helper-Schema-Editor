// Sets the app icon and version details on the Windows .exe.
// electron-builder normally does this with rcedit, which needs Wine when building
// on Linux/macOS. resedit is plain JavaScript, so the build works on any OS.
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  const PE = await import('pe-library');
  const ResEdit = await import('resedit');

  const { appInfo } = context.packager;
  const exePath = path.join(context.appOutDir, `${appInfo.productFilename}.exe`);
  const exe = PE.NtExecutable.from(fs.readFileSync(exePath));
  const res = PE.NtExecutableResource.from(exe);

  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'icon.ico')));
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = groups.length ? groups[0].id : 1;
  const lang = groups.length ? groups[0].lang : 1033;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries, groupId, lang, iconFile.icons.map((i) => i.data));

  const versions = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
  const version = versions[0] || ResEdit.Resource.VersionInfo.createEmpty();
  const [major, minor, patch] = appInfo.version.split('.').map((n) => parseInt(n, 10) || 0);
  version.setFileVersion(major, minor, patch, 0, 1033);
  version.setProductVersion(major, minor, patch, 0, 1033);
  version.setStringValues({ lang: 1033, codepage: 1200 }, {
    ProductName: appInfo.productName,
    FileDescription: appInfo.productName,
    CompanyName: appInfo.companyName || '',
    LegalCopyright: '',
    OriginalFilename: `${appInfo.productFilename}.exe`,
    InternalName: appInfo.productFilename,
  });
  version.outputToResourceEntries(res.entries);

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
};
