# Task Completion Checklist

After completing any coding task:

1. **Build**
   - Run `npm run compile` to ensure TypeScript compilation succeeds
   - Check esbuild bundling with `npm run esbuild`

2. **Type Safety**
   - Verify strict TypeScript types are used
   - Ensure all public methods have type annotations

3. **Testing**
   - Run `npm test` to verify functionality

4. **Code Quality**
   - Run `npm run lint` if available
   - Format code if formatter is available

5. **Git Operations**
   - Test relevant git operations using simple-git API
   - Verify gitignore patterns work as expected

6. **Documentation**
   - Update CHANGELOG.md with changes
   - Add inline comments for complex logic
