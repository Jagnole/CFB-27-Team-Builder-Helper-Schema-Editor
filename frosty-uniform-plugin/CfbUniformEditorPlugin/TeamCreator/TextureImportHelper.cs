using System;
using System.IO;
using System.Runtime.InteropServices;
using Frosty.Core;
using Frosty.Core.Viewport;
using FrostySdk;
using FrostySdk.IO;
using FrostySdk.Managers;
using FrostySdk.Managers.Entries;
using FrostySdk.Resources;

namespace CfbUniformEditorPlugin.TeamCreator
{
    /// <summary>
    /// Reimplements the relevant slice of TexturePlugin's FrostyTextureEditor.ImportButton_Click
    /// (see FrostyToolsuite/Plugins/TexturePlugin/FrostyTextureEditor.cs) directly in this plugin,
    /// rather than referencing TexturePlugin.dll, since dxtex.dll (the native DDS encoder it calls
    /// into) is a plain, separately-shipped DLL we can P/Invoke ourselves. TextureUtils/DDSHeader
    /// live in FrostyCore.dll (Frosty.Core.Viewport namespace) and are reused as-is.
    ///
    /// Deliberately scoped to TT_2d textures only -- every logo/UI slot in docs/team-creator.md is
    /// a plain 2D texture, so the cube/array mip-reinterleaving branch in the original editor code
    /// (not needed here) is left out. Always imports at the TARGET asset's existing pixel format --
    /// this tool never changes a slot's format, only its pixel content, so the format-detection
    /// logic in the original editor's private GetPixelFormat() isn't needed either.
    /// </summary>
    public static class TextureImportHelper
    {
        private enum ImageFormat { PNG, TGA, HDR, DDS }

        private struct BlobData
        {
            public byte[] Data
            {
                get
                {
                    byte[] outBuf = new byte[size];
                    Marshal.Copy(data, outBuf, 0, (int)size);
                    return outBuf;
                }
            }
            private IntPtr data;
            private long size;
        }

        private struct TextureImportOptions
        {
            public TextureType type;
            public SharpDX.DXGI.Format format;
            public bool generateMipmaps;
            public int mipmapsFilter;
            public bool resizeTexture;
            public int resizeFilter;
            public int resizeWidth;
            public int resizeHeight;
        }

        [DllImport("thirdparty/dxtex.dll", EntryPoint = "ConvertImageToDDS")]
        private static extern void ConvertImageToDDS(byte[] pData, long iDataSize, ImageFormat origFormat, TextureImportOptions options, ref BlobData pOutData);
        [DllImport("thirdparty/dxtex.dll", EntryPoint = "ReleaseBlob")]
        private static extern void ReleaseBlob(BlobData pData);

        private static ImageFormat DetectFormat(string filePath)
        {
            switch (Path.GetExtension(filePath).ToLowerInvariant())
            {
                case ".tga": return ImageFormat.TGA;
                case ".hdr": return ImageFormat.HDR;
                case ".dds": return ImageFormat.DDS;
                default: return ImageFormat.PNG;
            }
        }

        /// <summary>
        /// Imports <paramref name="imageFilePath"/> into the existing texture resource named
        /// <paramref name="resourceAssetPath"/>. Returns null on success, or an error message
        /// describing exactly what didn't match (dimensions, type, etc.) on failure -- nothing is
        /// modified if validation fails.
        /// </summary>
        public static string Import(string resourceAssetPath, string imageFilePath)
        {
            ResAssetEntry resEntry = App.AssetManager.GetResEntry(resourceAssetPath);
            if (resEntry == null)
                return $"No texture resource found at '{resourceAssetPath}' -- this base team may not have this slot, or the code/path is wrong.";

            Texture textureAsset = App.AssetManager.GetResAs<Texture>(resEntry);
            if (textureAsset == null)
                return $"'{resourceAssetPath}' exists but isn't a texture resource.";

            if (textureAsset.Type != TextureType.TT_2d)
                return $"'{resourceAssetPath}' is a {textureAsset.Type} texture -- this tool only supports plain 2D texture slots.";

            bool textureIsSRGB = (textureAsset.Flags & TextureFlags.SrgbGamma) != 0;
            ImageFormat srcFormat = DetectFormat(imageFilePath);
            BlobData blob = new BlobData();
            MemoryStream ddsStream;

            try
            {
                byte[] srcBytes = NativeReader.ReadInStream(new FileStream(imageFilePath, FileMode.Open, FileAccess.Read));

                if (srcFormat == ImageFormat.DDS)
                {
                    ddsStream = new MemoryStream(srcBytes);
                }
                else
                {
                    TextureImportOptions options = new TextureImportOptions
                    {
                        type = TextureType.TT_2d,
                        format = TextureUtils.ToShaderFormat(textureAsset.PixelFormat, textureIsSRGB),
                        generateMipmaps = textureAsset.MipCount > 1,
                        mipmapsFilter = 0,
                        resizeTexture = false,
                        resizeFilter = 0,
                        resizeWidth = 0,
                        resizeHeight = 0,
                    };

                    ConvertImageToDDS(srcBytes, srcBytes.Length, srcFormat, options, ref blob);
                    ddsStream = new MemoryStream(blob.Data);
                }

                using (NativeReader reader = new NativeReader(ddsStream))
                {
                    TextureUtils.DDSHeader header = new TextureUtils.DDSHeader();
                    if (!header.Read(reader))
                        return $"'{imageFilePath}' didn't produce a valid DDS (conversion failed or the source file is corrupt).";

                    if (TextureUtils.IsCompressedFormat(textureAsset.PixelFormat) && textureAsset.MipCount > 1)
                    {
                        if (header.dwWidth % 4 != 0 || header.dwHeight % 4 != 0)
                            return $"'{imageFilePath}' is {header.dwWidth}x{header.dwHeight} -- this slot's compressed format needs width/height divisible by 4.";
                    }

                    ResAssetEntry liveResEntry = App.AssetManager.GetResEntry(resourceAssetPath);
                    ChunkAssetEntry chunkEntry = App.AssetManager.GetChunkEntry(textureAsset.ChunkId);

                    byte[] buffer = new byte[reader.Length - reader.Position];
                    reader.Read(buffer, 0, (int)(reader.Length - reader.Position));

                    Texture newTextureAsset = new Texture(TextureType.TT_2d, textureAsset.PixelFormat, (ushort)header.dwWidth, (ushort)header.dwHeight, 1)
                    {
                        FirstMip = textureAsset.FirstMip
                    };
                    if (header.dwMipMapCount <= textureAsset.FirstMip)
                        newTextureAsset.FirstMip = 0;

                    newTextureAsset.TextureGroup = textureAsset.TextureGroup;
                    newTextureAsset.CalculateMipData((byte)header.dwMipMapCount, TextureUtils.GetFormatBlockSize(textureAsset.PixelFormat), TextureUtils.IsCompressedFormat(textureAsset.PixelFormat), (uint)buffer.Length);
                    newTextureAsset.Flags = textureAsset.Flags;

                    if (ProfilesLibrary.MustAddChunks && chunkEntry.Bundles.Count == 0 && !chunkEntry.IsAdded)
                    {
                        textureAsset.ChunkId = App.AssetManager.AddChunk(buffer, null, (newTextureAsset.Flags & TextureFlags.OnDemandLoaded) != 0 ? null : newTextureAsset);
                        chunkEntry = App.AssetManager.GetChunkEntry(textureAsset.ChunkId);
                    }
                    else
                    {
                        App.AssetManager.ModifyChunk(textureAsset.ChunkId, buffer, (newTextureAsset.Flags & TextureFlags.OnDemandLoaded) != 0 ? null : newTextureAsset);
                    }

                    for (int i = 0; i < 4; i++)
                        newTextureAsset.Unknown3[i] = textureAsset.Unknown3[i];
                    newTextureAsset.SetData(textureAsset.ChunkId, App.AssetManager);

                    App.AssetManager.ModifyRes(liveResEntry.ResRid, newTextureAsset);
                    liveResEntry.LinkAsset(chunkEntry);
                    textureAsset.Dispose();
                }

                return null;
            }
            finally
            {
                ReleaseBlob(blob);
            }
        }
    }
}
