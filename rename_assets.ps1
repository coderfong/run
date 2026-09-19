$counter = 29
Get-ChildItem 'C:\Users\user\Desktop\run\frontend\assets\character\face\ChatGPT Image*.png' | Sort-Object Name | ForEach-Object {
    $newName = "faceN$counter.png"
    Rename-Item $_.FullName -NewName $newName
    $counter++
}
Write-Host "Renamed $counter files"