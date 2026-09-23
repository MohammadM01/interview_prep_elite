'use client';

import { useState } from 'react';
import AuthTester from '@/components/AuthTester';
import KitCreator from '@/components/KitCreator';

export default function HomePage() {
  const [currentUser, setCurrentUser] = useState(null);

  return (
    <main className="min-h-screen bg-[#FAFAF9] text-[#18181B] flex flex-col justify-between p-8 md:p-16">
      <header className="flex items-center justify-between border-b border-[#E4E4E7] pb-6">
        <div className="flex items-center gap-3">
          <div className="h-8 px-2.5 rounded-md bg-[#18181B] text-white flex items-center justify-center font-semibold text-xs tracking-wider">
            IPE
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight">Interview Preparation Elite</h1>
            <p className="text-xs text-[#71717A]">AI-Powered Personalized Prep Kits</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-[#F4F4F5] text-[#18181B] border border-[#E4E4E7]">
            Step 3 Kit Foundation Active
          </span>
        </div>
      </header>

      <section className="max-w-2xl my-auto py-12">
        <p className="text-xs uppercase tracking-widest text-[#71717A] font-medium mb-3">
          Full Stack Assessment Foundation
        </p>
        <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-[#18181B] mb-4">
          Personalized interview preparation powered by deterministic research.
        </h2>
        <p className="text-[#71717A] text-base leading-relaxed mb-8">
          Enter a role job description, target company address, and interview timeline to initialize your preparation kit and generation job pipeline.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-[#E4E4E7] pt-8">
          <div className="p-4 rounded-lg bg-white border border-[#E4E4E7]">
            <p className="text-xs text-[#71717A] mb-1">Frontend Service</p>
            <p className="text-sm font-medium text-[#18181B]">Next.js 16 App Router</p>
          </div>
          <div className="p-4 rounded-lg bg-white border border-[#E4E4E7]">
            <p className="text-xs text-[#71717A] mb-1">Backend Service</p>
            <p className="text-sm font-medium text-[#18181B]">Node.js 24 + Express</p>
          </div>
          <div className="p-4 rounded-lg bg-white border border-[#E4E4E7]">
            <p className="text-xs text-[#71717A] mb-1">Database Layer</p>
            <p className="text-sm font-medium text-[#18181B]">MongoDB Atlas Connected</p>
          </div>
        </div>

        <AuthTester onUserChange={setCurrentUser} />
        <KitCreator currentUser={currentUser} />
      </section>

      <footer className="border-t border-[#E4E4E7] pt-6 flex flex-col sm:flex-row items-center justify-between text-xs text-[#71717A] gap-4">
        <p>Interview Preparation Elite</p>
        <p>Interview Preparation Elite (IPE)</p>
      </footer>
    </main>
  );
}
