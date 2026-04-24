import { activeBlocksLib } from '../data/blocks/index';

export function insertCodeBlock(activeLanguage: string, blockType: string, editorRef: any) {
  if (!editorRef) return;

  const languageBlocks = activeBlocksLib[activeLanguage];
  if (!languageBlocks) {
    console.warn(`No blocks defined for language: ${activeLanguage}`);
    return;
  }

  const blockConfig = languageBlocks[blockType];
  if (blockConfig && blockConfig.TextBlock) {
    editorRef.insertTextAtCursor(blockConfig.TextBlock);
  } else {
    console.warn(`Block type '${blockType}' not found or has no TextBlock for language '${activeLanguage}'.`);
  }
}
