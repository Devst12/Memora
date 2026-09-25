export default function Home() {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-[#f7f6f2] text-[#20251f]">
      <div aria-hidden="true" className="pointer-events-none absolute -right-32 -top-40 h-[34rem] w-[34rem] rounded-full bg-[#dce8d9] blur-3xl" />

      <header className="relative mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-7 sm:px-10">
        <a href="/" className="flex items-center gap-3" aria-label="Memora home">
          <span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-[#314b3a] text-lg font-semibold text-white">m</span>
          <span className="text-xl font-semibold tracking-[-0.04em]">memora</span>
        </a>
        <span className="hidden rounded-full border border-[#d9ddd5] bg-white/70 px-4 py-2 text-sm text-[#687166] sm:inline-flex">A calmer place for what you find</span>
      </header>

      <section className="relative mx-auto grid w-full max-w-6xl flex-1 items-center gap-14 px-6 pb-20 pt-10 sm:px-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-20 lg:py-20">
        <div className="max-w-2xl">
          <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#dce2d8] bg-white/75 px-4 py-2 text-sm font-medium text-[#52644f]">
            <span className="h-2 w-2 rounded-full bg-[#7e9a72]" /> Your personal digital memory
          </p>
          <h1 className="text-5xl font-semibold leading-[1.04] tracking-[-0.065em] sm:text-6xl lg:text-[4.5rem]">
            Keep what matters.<br />
            <span className="font-serif font-normal italic text-[#66805f]">Find it when it counts.</span>
          </h1>
          <p className="mt-7 max-w-xl text-lg leading-8 text-[#697067] sm:text-xl sm:leading-9">
            Memora is a home for the videos, articles, ideas, and inspiration you want to come back to. Save them with a little context, then find and revisit them when you need them.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-x-5 gap-y-3 text-sm text-[#73796f]">
            <span className="flex items-center gap-2"><span className="text-[#718b68]">✳</span> Save from across the web</span>
            <span className="flex items-center gap-2"><span className="text-[#718b68]">✳</span> Remember why it mattered</span>
            <span className="flex items-center gap-2"><span className="text-[#718b68]">✳</span> Revisit it when it counts</span>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-md">
          <div aria-hidden="true" className="absolute -inset-5 rounded-[2rem] bg-[#e9e9df] blur-xl" />
          <div className="relative rounded-[1.75rem] border border-[#e6e5dc] bg-white p-5 shadow-[0_24px_80px_-40px_rgba(39,54,39,0.35)] sm:p-7">
            <div className="flex items-center justify-between border-b border-[#efeee8] pb-5">
              <div>
                <p className="text-sm font-semibold">A note to your future self</p>
                <p className="mt-1 text-xs text-[#92968d]">A few things worth remembering</p>
              </div>
              <span className="rounded-full bg-[#f1f4ef] px-3 py-1.5 text-xs font-medium text-[#65775e]">Your memory</span>
            </div>
            <article className="mt-5 rounded-2xl bg-[#f6f5f0] p-4 sm:p-5">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e7ede2] text-lg">▶</span>
                <div>
                  <p className="text-sm font-medium">A thoughtful guide to color</p>
                  <p className="mt-1 text-xs text-[#8a8f86]">YouTube · Saved today</p>
                </div>
              </div>
              <p className="text-sm leading-6 text-[#70766c]">“Try this look for the short film next month.”</p>
              <div className="mt-4 flex gap-2"><span className="rounded-full bg-white px-3 py-1 text-xs text-[#6d7967]">Inspiration</span><span className="rounded-full bg-white px-3 py-1 text-xs text-[#6d7967]">Video editing</span></div>
            </article>
            <div className="mt-4 flex items-center gap-3 rounded-2xl border border-[#eeede6] p-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f4eee3] text-lg">✎</span>
              <div><p className="text-sm font-medium">The idea you almost forgot</p><p className="mt-1 text-xs text-[#8a8f86]">An article · Saved last week</p></div>
            </div>
            <div className="mt-5 flex items-center justify-between border-t border-[#efeee8] pt-4 text-xs text-[#8a8f86]"><span>Saved with intention</span><span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-[#88a17d]" /> Ready to revisit</span></div>
          </div>
        </div>
      </section>
      <footer className="relative mx-auto w-full max-w-6xl px-6 pb-7 text-xs text-[#92968d] sm:px-10">Memora · Make room for what you want to remember.</footer>
    </main>
  );
}
