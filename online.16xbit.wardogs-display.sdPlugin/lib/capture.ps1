# Persistent screen-region grabber. Reads "x y w h scale threshold mode" lines on stdin,
# answers with one base64 PNG line (or "ERR message") per request.
# "size" -> "SIZE w h"; "fg" -> "FG processName|window title" (the window that has focus).
# mode: 0 = luminance, 1 = max channel, 2 = saturation, 3 = luminance with automatic (Otsu) threshold.
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System.Runtime.InteropServices;
public class Dpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }
"@
[Dpi]::SetProcessDPIAware() | Out-Null
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Fg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
}
"@
Add-Type -ReferencedAssemblies System.Drawing @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public class Bin {
  static int Otsu(int[] hist, long total) {
    double sum = 0;
    for (int t = 0; t < 256; t++) sum += (double)t * hist[t];
    double sumB = 0, best = -1;
    long wB = 0;
    int thr = 128;
    for (int t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB == 0) continue;
      long wF = total - wB;
      if (wF == 0) break;
      sumB += (double)t * hist[t];
      double mB = sumB / wB, mF = (sum - sumB) / wF;
      double v = (double)wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; thr = t + 1; }
    }
    return thr;
  }

  // Bright pixels (HUD text) become black, everything else white, plus a white margin.
  public static Bitmap Run(Bitmap src, int thr, int pad, int mode) {
    int w = src.Width, h = src.Height;
    BitmapData sd = src.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
    int stride = sd.Stride;
    byte[] sBuf = new byte[stride * h];
    Marshal.Copy(sd.Scan0, sBuf, 0, sBuf.Length);
    src.UnlockBits(sd);

    int[] vals = new int[w * h];
    int[] hist = new int[256];
    for (int y = 0; y < h; y++) {
      for (int x = 0; x < w; x++) {
        int i = y * stride + x * 3;
        int b = sBuf[i], gg = sBuf[i + 1], r = sBuf[i + 2];
        int mx = Math.Max(b, Math.Max(gg, r)), mn = Math.Min(b, Math.Min(gg, r));
        int v = mode == 1 ? mx : (mode == 2 ? mx - mn : (b * 114 + gg * 587 + r * 299) / 1000);
        vals[y * w + x] = v;
        hist[v]++;
      }
    }
    if (mode == 3) thr = Otsu(hist, (long)w * h);

    Bitmap dst = new Bitmap(w + 2 * pad, h + 2 * pad, PixelFormat.Format24bppRgb);
    BitmapData dd = dst.LockBits(new Rectangle(0, 0, dst.Width, dst.Height), ImageLockMode.WriteOnly, PixelFormat.Format24bppRgb);
    byte[] white = new byte[dd.Stride];
    for (int i = 0; i < white.Length; i++) white[i] = 255;
    for (int y = 0; y < dst.Height; y++) Marshal.Copy(white, 0, IntPtr.Add(dd.Scan0, y * dd.Stride), dd.Stride);
    byte[] line = new byte[w * 3];
    for (int y = 0; y < h; y++) {
      for (int x = 0; x < w; x++) {
        byte c = vals[y * w + x] >= thr ? (byte)0 : (byte)255;
        line[x * 3] = c; line[x * 3 + 1] = c; line[x * 3 + 2] = c;
      }
      Marshal.Copy(line, 0, IntPtr.Add(dd.Scan0, (y + pad) * dd.Stride + pad * 3), line.Length);
    }
    dst.UnlockBits(dd);
    return dst;
  }
}
"@

while (($line = [Console]::In.ReadLine()) -ne $null) {
  try {
    if ($line.Trim() -eq 'size') {
      $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
      [Console]::Out.WriteLine("SIZE " + $b.Width + " " + $b.Height)
      [Console]::Out.Flush()
      continue
    }
    if ($line.Trim() -eq 'fg') {
      $hwnd = [Fg]::GetForegroundWindow()
      $fgPid = 0
      [void][Fg]::GetWindowThreadProcessId($hwnd, [ref]$fgPid)
      $sb = New-Object System.Text.StringBuilder 256
      [void][Fg]::GetWindowText($hwnd, $sb, 256)
      $procName = ""
      try { $procName = [System.Diagnostics.Process]::GetProcessById($fgPid).ProcessName } catch { }
      $winTitle = $sb.ToString().Replace("`r", " ").Replace("`n", " ")
      [Console]::Out.WriteLine("FG " + $procName + "|" + $winTitle)
      [Console]::Out.Flush()
      continue
    }
    $p = $line.Trim().Split(' ')
    $x = [int]$p[0]; $y = [int]$p[1]; $w = [int]$p[2]; $h = [int]$p[3]; $s = [int]$p[4]
    $thr = 0; if ($p.Length -gt 5) { $thr = [int]$p[5] }
    $mode = 0; if ($p.Length -gt 6) { $mode = [int]$p[6] }
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($x, $y, 0, 0, $bmp.Size)
    $g.Dispose()
    $out = $bmp
    if ($s -gt 1) {
      $out = New-Object System.Drawing.Bitmap ($w * $s), ($h * $s)
      $g2 = [System.Drawing.Graphics]::FromImage($out)
      $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g2.DrawImage($bmp, 0, 0, ($w * $s), ($h * $s))
      $g2.Dispose()
      $bmp.Dispose()
    }
    if ($thr -gt 0 -or $mode -eq 3) {
      $b2 = [Bin]::Run($out, $thr, 12, $mode)
      $out.Dispose()
      $out = $b2
    }
    $ms = New-Object System.IO.MemoryStream
    $out.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $out.Dispose()
    [Console]::Out.WriteLine([Convert]::ToBase64String($ms.ToArray()))
  } catch {
    [Console]::Out.WriteLine("ERR " + $_.Exception.Message)
  }
  [Console]::Out.Flush()
}
