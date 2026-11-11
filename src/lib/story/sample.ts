import type { Story } from "./schema";

/** Hand-written 9-node sample used by tests and as the engine smoke test. */
export const SAMPLE_STORY: Story = {
  meta: {
    title: "雨夜书店",
    genre: "悬疑",
    tone: "压抑、克制",
    synopsis: "暴雨夜，你走进一家快打烊的旧书店，寻找一本十年前卖出的书。",
    start: "n1",
    preface: "十年前，城南的旧书店烧过一场大火。今夜暴雨，你攥着一张褪色的购书小票，推开了那扇还亮着灯的门。",
    player: { name: null, identity: "你是一个寻找旧书的陌生人" },
    premise: {
      question: "十年前那场火，和你要找的书有什么关系？",
      playerGoal: "找到那本书和它的上一任主人",
      stakes: "错过今夜，真相会和书一起消失",
      hiddenTruth: "那本书里夹着纵火者的认罪信；沈先生就是当年放火的人，他也在找这本书。",
    },
  },
  variables: [{ id: "trust_lin", label: "林晚的信任", init: 0, min: -2, max: 5 }],
  characters: [
    { id: "lin", name: "林晚", role: "书店老板", personality: "警惕、重感情", voice: "话少，句子短，从不正面回答问题", avatar: "🕯️", color: "#c9a96e", intro: "旧书店的老板，十年前那场火之后一直守着这家店", traits: ["警惕", "重情", "嘴硬"], sampleLines: ["打烊了。", "……书在不在，跟你有什么关系。"] },
    { id: "shen", name: "沈先生", role: "神秘顾客", personality: "彬彬有礼却让人不安", voice: "措辞客气，总在笑", avatar: "🎩", color: "#7fa7c9", intro: "深夜才来的熟客，总在笑", traits: ["客气", "危险"], sampleLines: ["哎呀，这么巧。", "您别紧张，我只是来买书的。"] },
  ],
  nodes: [
    {
      id: "n1", type: "scene", bg: "雨夜·旧书店门口",
      lines: [
        { speaker: null, text: "雨下得很大，书店的灯还亮着。" },
        { speaker: "lin", text: "我们打烊了。" },
      ],
      choices: [
        { text: "我只是来躲雨的。", next: "n2", condition: null, effects: [{ var: "trust_lin", op: "add", value: 1 }] },
        { text: "我在找一本书，十年前卖出的。", next: "n3", condition: null, effects: [] },
      ],
    },
    {
      id: "n2", type: "scene", bg: "书店·柜台",
      lines: [
        { speaker: "lin", text: "……喝杯热茶再走吧。" },
        { speaker: "lin", text: "十年前那场火之后，很少有人在雨夜来了。" },
      ],
      choices: [
        { text: "什么火？", next: "n4", condition: null, effects: [{ var: "trust_lin", op: "add", value: 1 }] },
        { text: "其实我在找一本书。", next: "n3", condition: null, effects: [] },
      ],
    },
    {
      id: "n3", type: "scene", bg: "书店·书架间",
      lines: [
        { speaker: "lin", text: "那本书，不卖。" },
        { speaker: null, text: "门铃响了，一位戴礼帽的先生走了进来。" },
        { speaker: "shen", text: "这么晚还有客人，真巧。" },
      ],
      choices: [
        { text: "和那位先生搭话。", next: "n5", condition: null, effects: [] },
        { text: "继续追问林晚。", next: "n4", condition: null, effects: [{ var: "trust_lin", op: "add", value: -1 }] },
      ],
    },
    {
      id: "n4", type: "scene", bg: "书店·柜台",
      lines: [
        { speaker: "lin", text: "火是从地下室烧起来的。" },
        { speaker: "lin", text: "我父亲没出来。" },
      ],
      choices: [
        { text: "（出示证件）我是来查这件案子的。", next: "n6", condition: { var: "trust_lin", op: ">=", value: 2 }, effects: [] },
        { text: "那一定很难熬。", next: "n6", condition: null, effects: [{ var: "trust_lin", op: "add", value: 1 }] },
        { text: "雨停了，我该走了。", next: "e_bad", condition: null, effects: [] },
      ],
    },
    {
      id: "n5", type: "scene", bg: "书店·门边",
      lines: [
        { speaker: "shen", text: "如果你在找那本书，不妨看看这个。" },
        { speaker: null, text: "他塞给你一张纸条，转身消失在雨里。" },
      ],
      choices: [
        { text: "把纸条交给林晚。", next: "n6", condition: null, effects: [{ var: "trust_lin", op: "add", value: 1 }] },
        { text: "自己收起纸条离开。", next: "e_bad", condition: null, effects: [] },
      ],
    },
    {
      id: "n6", type: "scene", bg: "书店·地下室入口",
      lines: [
        { speaker: "lin", text: "地下室的门，十年没开过了。" },
        { speaker: null, text: "门缝里透出一丝凉气。" },
      ],
      choices: [
        { text: "我们一起打开它。", next: "e_secret", condition: { var: "trust_lin", op: ">=", value: 3 }, effects: [] },
        { text: "这事该交给警方。", next: "e_good", condition: null, effects: [] },
      ],
    },
    {
      id: "e_good", type: "ending", bg: "清晨·警局", endingKind: "good", title: "迟到的结案",
      lines: [{ speaker: null, text: "警方在地下室找到了当年的证据，案子终于结了。" }],
    },
    {
      id: "e_bad", type: "ending", bg: "雨夜·街头", endingKind: "bad", title: "雨中离去",
      lines: [{ speaker: null, text: "你走进雨里。那本书，再也没人见过。" }],
    },
    {
      id: "e_secret", type: "ending", bg: "书店·地下室", endingKind: "secret", title: "旧信",
      lines: [
        { speaker: null, text: "地下室里只有一只铁盒，装着一封没寄出的信。" },
        { speaker: "lin", text: "……原来他是为了救我。" },
      ],
    },
  ],
};
