# export_materials.ps1
# 导出 Docker 生成的中间素材（TTS音频 / 图片 / 视频片段）到指定目录
# 用法: .\export_materials.ps1 [-ProjectId <id>] [-OutputDir <path>] [-List]

param(
    [string]$ProjectId = "",
    [string]$OutputDir = ".\exports",
    [switch]$List
)

$ProjectsBase = "D:\work\novel-workflow\projects"

# ─── 列出所有项目 ───────────────────────────────────────────────
function Show-Projects {
    Write-Host "`n=== 已有项目 ===" -ForegroundColor Cyan
    $projects = Get-ChildItem $ProjectsBase -Directory -ErrorAction SilentlyContinue
    if (-not $projects) {
        Write-Host "  (无项目)" -ForegroundColor Gray
        return
    }
    foreach ($p in $projects) {
        $id = $p.Name
        $images  = (Get-ChildItem "$($p.FullName)\images"  -Filter "*.png" -ErrorAction SilentlyContinue).Count
        $clips   = (Get-ChildItem "$($p.FullName)\clips"   -Filter "*.mp4" -ErrorAction SilentlyContinue).Count
        $ttsAct  = (Get-ChildItem "$($p.FullName)\audio"   -Filter "*_action.*" -ErrorAction SilentlyContinue).Count
        $ttsDlg  = (Get-ChildItem "$($p.FullName)\audio"   -Filter "*_dialogue.*" -ErrorAction SilentlyContinue).Count
        $final   = Test-Path "$($p.FullName)\final_video.mp4"
        $finalMark = if ($final) { "✓ final" } else { "" }
        Write-Host ("  [{0}]  图片:{1}  视频片段:{2}  TTS动作:{3}  TTS对话:{4}  {5}" -f $id, $images, $clips, $ttsAct, $ttsDlg, $finalMark)
    }
    Write-Host ""
}

# ─── 导出单个项目 ────────────────────────────────────────────────
function Export-Project {
    param([string]$Id, [string]$Dest)

    $srcDir = Join-Path $ProjectsBase $Id
    if (-not (Test-Path $srcDir)) {
        Write-Host "项目不存在: $Id" -ForegroundColor Red
        return
    }

    $destDir = Join-Path $Dest $Id
    New-Item -ItemType Directory -Force -Path $destDir | Out-Null

    $copied = 0

    # 图片
    $imgSrc = Join-Path $srcDir "images"
    if (Test-Path $imgSrc) {
        $imgDest = Join-Path $destDir "images"
        New-Item -ItemType Directory -Force -Path $imgDest | Out-Null
        $files = Get-ChildItem $imgSrc -Filter "*.png"
        foreach ($f in $files) {
            Copy-Item $f.FullName -Destination $imgDest -Force
            $copied++
        }
        Write-Host "  图片: $($files.Count) 张 → $imgDest" -ForegroundColor Green
    }

    # 视频片段
    $clipSrc = Join-Path $srcDir "clips"
    if (Test-Path $clipSrc) {
        $clipDest = Join-Path $destDir "clips"
        New-Item -ItemType Directory -Force -Path $clipDest | Out-Null
        $files = Get-ChildItem $clipSrc -Filter "*.mp4"
        foreach ($f in $files) {
            Copy-Item $f.FullName -Destination $clipDest -Force
            $copied++
        }
        Write-Host "  视频片段: $($files.Count) 段 → $clipDest" -ForegroundColor Green
    }

    # TTS 音频
    $audioSrc = Join-Path $srcDir "audio"
    if (Test-Path $audioSrc) {
        $audioDest = Join-Path $destDir "audio"
        New-Item -ItemType Directory -Force -Path $audioDest | Out-Null
        $files = Get-ChildItem $audioSrc -Include "*.mp3","*.wav","*.ogg" -Recurse
        foreach ($f in $files) {
            Copy-Item $f.FullName -Destination $audioDest -Force
            $copied++
        }
        Write-Host "  TTS音频: $($files.Count) 个 → $audioDest" -ForegroundColor Green
    }

    # 最终视频
    $finalSrc = Join-Path $srcDir "final_video.mp4"
    if (Test-Path $finalSrc) {
        Copy-Item $finalSrc -Destination $destDir -Force
        $copied++
        Write-Host "  最终视频 → $destDir\final_video.mp4" -ForegroundColor Green
    }

    # 分镜 JSON（方便参考）
    $sbSrc = Join-Path $srcDir "storyboard.json"
    if (Test-Path $sbSrc) {
        Copy-Item $sbSrc -Destination $destDir -Force
    }

    Write-Host "  合计复制: $copied 个文件" -ForegroundColor Cyan
}

# ─── 主逻辑 ─────────────────────────────────────────────────────
Write-Host "=== Novel Workflow 素材导出工具 ===" -ForegroundColor Yellow
Write-Host "素材目录: $ProjectsBase"

if ($List -or (-not $ProjectId)) {
    Show-Projects
    if (-not $ProjectId) {
        Write-Host "用法示例:" -ForegroundColor Gray
        Write-Host "  .\export_materials.ps1 -ProjectId test-gpu-001" -ForegroundColor Gray
        Write-Host "  .\export_materials.ps1 -ProjectId test-gpu-001 -OutputDir D:\exports" -ForegroundColor Gray
        Write-Host "  .\export_materials.ps1 -List   # 只列出项目" -ForegroundColor Gray
        exit 0
    }
}

Write-Host "`n导出项目: $ProjectId" -ForegroundColor Yellow
Write-Host "目标目录: $OutputDir`n"

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if ($ProjectId -eq "all") {
    $projects = Get-ChildItem $ProjectsBase -Directory -ErrorAction SilentlyContinue
    foreach ($p in $projects) {
        Write-Host "--- $($p.Name) ---" -ForegroundColor Yellow
        Export-Project -Id $p.Name -Dest $OutputDir
    }
} else {
    Export-Project -Id $ProjectId -Dest $OutputDir
}

Write-Host "`n完成！" -ForegroundColor Green
Write-Host "导出路径: $(Resolve-Path $OutputDir)"
