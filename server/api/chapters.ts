import { VercelRequest, VercelResponse } from "@vercel/node";

export default async (req: VercelRequest, res: VercelResponse) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const chapters = [
    {
      id: 1,
      name: "Chapter 1",
      levelCap: 15,
      expMult: 1.0,
      goldMult: 1.0,
      storyText: "The journey begins...",
      backdrop: "chapter1.jpg"
    },
    {
      id: 2,
      name: "Chapter 2",
      levelCap: 30,
      expMult: 0.8,
      goldMult: 1.2,
      storyText: "The challenges grow...",
      backdrop: "chapter2.jpg"
    },
    {
      id: 3,
      name: "Chapter 3",
      levelCap: 50,
      expMult: 0.6,
      goldMult: 1.5,
      storyText: "Darkness looms...",
      backdrop: "chapter3.jpg"
    },
    {
      id: 4,
      name: "Chapter 4",
      levelCap: 75,
      expMult: 0.5,
      goldMult: 2.0,
      storyText: "The truth reveals itself...",
      backdrop: "chapter4.jpg"
    },
    {
      id: 5,
      name: "Chapter 5",
      levelCap: 100,
      expMult: 0.4,
      goldMult: 2.5,
      storyText: "An ancient power awakens...",
      backdrop: "chapter5.jpg"
    },
    {
      id: 6,
      name: "Chapter 6",
      levelCap: 150,
      expMult: 0.3,
      goldMult: 3.0,
      storyText: "The cosmic forces converge...",
      backdrop: "chapter6.jpg"
    },
    {
      id: 7,
      name: "Chapter 7",
      levelCap: 200,
      expMult: 0.2,
      goldMult: 4.0,
      storyText: "Reality bends to your will...",
      backdrop: "chapter7.jpg"
    },
    {
      id: 8,
      name: "Chapter 8",
      levelCap: 300,
      expMult: 0.1,
      goldMult: 5.0,
      storyText: "The final trial awaits...",
      backdrop: "chapter8.jpg"
    }
  ];

  return res.status(200).json({ chapters });
};