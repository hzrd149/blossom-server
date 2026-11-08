export function App() {
  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      <section
        className="card border border-base-300 bg-base-100 shadow-sm"
        aria-labelledby="admin-heading"
      >
        <div className="card-body">
          <h1 id="admin-heading" className="card-title text-2xl">
            Blossom Admin
          </h1>
          <p className="text-base-content/70">
            The new management console starts here.
          </p>
        </div>
      </section>
    </main>
  );
}
