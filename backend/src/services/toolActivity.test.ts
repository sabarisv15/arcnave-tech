import { expect, it } from 'vitest';
import { activityOutputFiles } from './toolActivity.js';

it('reports only confirmed saved files, never expected outputs or failed results', () => {
  const content = [{ type: 'json' as const, data: { expected_outputs: ['planned.json'], persistedFiles: [{ filename: 'actual.json', downloadUrl: '/files/id' }, {filename: 'not-saved.json'}] } }];
  expect(activityOutputFiles({toolCallId:'1',ok:true,content})).toEqual(['actual.json']);
  expect(activityOutputFiles({toolCallId:'1',ok:false,content})).toEqual([]);
});

it('handles direct deliverables and unstructured results without exposing raw content', () => {
  expect(activityOutputFiles({toolCallId:'1',ok:true,content:[{type:'json',data:{filename:'report.pdf',downloadUrl:'/files/id'}},{type:'text',text:'raw execution output'}]})).toEqual(['report.pdf']);
  expect(activityOutputFiles({toolCallId:'1',ok:true,content:[{type:'json',data:{file:{filename:'merged.pdf',downloadUrl:'/files/id'}}}]})).toEqual(['merged.pdf']);
  expect(activityOutputFiles({toolCallId:'1',ok:true,content:[{type:'json',data:{files:[{filename:'part.pdf',downloadUrl:'/files/id'}]}}]})).toEqual(['part.pdf']);
});
